import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push';
import multer from 'multer';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; 
import { Upload } from "@aws-sdk/lib-storage";
import { connectToDatabase } from '../config/db.js';
import { getS3Client, getPrivateUrl, PutObjectCommand } from '../config/s3.js';
import { authenticateToken } from './auth.js';
import { sendOfflineNotification } from '../utils/mailer.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. GET CHAT HISTORY (WITH PAGINATION AND TIMELINE CURSORS) ---
router.get('/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    const { beforeId, limit } = req.query;

    // Build standard query criteria matching messages between the two users
    const query = {
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    };
    if (beforeId && mongoose.isValidObjectId(beforeId)) {
      const referenceMsg = await Message.findById(beforeId);
      if (referenceMsg) {
        query.createdAt = { $lt: referenceMsg.createdAt };
      }
    }

    const parsedLimit = parseInt(limit) || 20;
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parsedLimit)
      .lean();
    const displayMessages = messages.reverse();
    const finalMessages = await Promise.all(displayMessages.map(async (m) => {
      if (m.fileUrl && (m.fileType === 'image' || m.fileType === 'video')) {
        m.fileUrl = await getPrivateUrl(m.fileUrl);
      }
      return m;
    }));

    res.json({ success: true, messages: finalMessages });
  } catch (err) {
    console.error("History retrieval error:", err);
    res.status(500).json({ success: false, message: "Error loading chat history" });
  }
});

// --- 2. SEND TEXT MESSAGE ---
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, receiverModel } = req.body;
    const myId = req.user.id; 
    const senderRole = req.user.role === 'agent' ? 'Agent' : 'User';

    if (!text || !receiverId) {
      return res.status(400).json({ success: false, message: "Text and receiverId are required" });
    }

    const finalReceiverModel = receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent');
    
    const newMessage = new Message({
      senderId: myId,
      senderModel: senderRole,
      receiverId,
      receiverModel: finalReceiverModel,
      text,
      notificationSent: false
    });
    await newMessage.save();

    const TargetModel = finalReceiverModel === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId);
    const sender = await (senderRole === 'Agent' ? Agent : User).findById(myId);

    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    // --- WEB PUSH ---
    if (receiver?.pushSubscription) {
      try {
        const payload = JSON.stringify({
          title: `New Message from ${sender?.firstName || 'Zing'}`,
          body: text,
          data: { 
            url: finalReceiverModel === 'Agent' 
              ? `/agent/dashboard?userId=${myId}` 
              : `/user/dashboard?agentId=${myId}` 
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
      } catch (pushErr) {
        console.error("Push Notification Failed:", pushErr.message);
      }
    }

    // --- EMAIL OFFLINE NOTIFICATION ---
    if (!isOnline && receiver) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const now = Date.now();
        const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (now - lastEmailTime > COOLDOWN) {
          await TargetModel.findByIdAndUpdate(receiverId, { lastNotificationEmail: new Date() });
          await sendOfflineNotification(receiver, sender, text, finalReceiverModel);
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    if (isOnline && io) {
      io.to(receiverId.toString()).emit("new-message", newMessage);
    }

    res.status(201).json({ success: true, message: newMessage });
  } catch (err) {
    console.error("Critical Send Error:", err);
    res.status(500).json({ success: false, message: "Failed to send", error: err.message });
  }
});

// --- 3. SERVER-SIDE MULTIPART UPLOAD ---
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, text } = req.body; 
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });

    const mimeType = req.file.mimetype;
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${req.file.originalname.split('.').pop()}`;

    // Upload to iDrive S3 Storage
    const parallelUploads3 = new Upload({
      client: getS3Client(),
      params: {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: mimeType,
      },
    });
    await parallelUploads3.done();

    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    const senderModel = req.user.role === 'agent' ? 'Agent' : 'User';
    
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel,
      receiverId,
      receiverModel,
      text: text || "", 
      fileUrl: fileName, 
      fileType: detectedType,
      status: 'sent',
      notificationSent: false
    });
    await newMessage.save();

    // Resolve pre-signed URL for front-end consumption
    const signedUrlForFrontend = await getPrivateUrl(fileName);

    // Build immediate payload wrapper to avoid real-time socket race conditions
    const outputPayload = { ...newMessage.toObject(), fileUrl: signedUrlForFrontend };

    // --- NOTIFICATION & SOCKET PIPELINE ---
    const TargetModel = receiverModel === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId);
    const sender = await (senderModel === 'Agent' ? Agent : User).findById(req.user.id);
    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    if (receiver?.pushSubscription) {
      const payload = JSON.stringify({
        title: `New ${detectedType} from ${sender?.firstName || 'Zing'}`,
        body: text || `Sent an ${detectedType}`,
        data: { url: receiverModel === 'Agent' ? '/agent/dashboard' : '/user/dashboard' }
      });
      webpush.sendNotification(receiver.pushSubscription).catch(e => console.error(e));
    }

    if (!isOnline && receiver) {
      const COOLDOWN = 30 * 60 * 1000;
      const lastEmail = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;
      if (Date.now() - lastEmail > COOLDOWN) {
        // FIXED: Swapped out reference-breaking fileUrl with verified fileName variable wrapper
        await sendOfflineNotification(receiver, sender, text || `Sent an ${detectedType}`, receiverModel);
        await TargetModel.findByIdAndUpdate(receiverId, { lastNotificationEmail: new Date() });
      }
    }

    if (isOnline && io) { 
      io.to(receiverId.toString()).emit("new-message", outputPayload); 
    }

    res.status(201).json({ success: true, message: outputPayload });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.message);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
});

// --- 4. MARK AS READ ---
router.patch('/mark-read/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const myId = req.user.id;
    const { otherUserId } = req.params;
    const result = await Message.updateMany(
      { senderId: otherUserId, receiverId: myId, status: { $ne: 'seen' } },
      { $set: { status: 'seen', seenAt: new Date() } }
    );
    res.json({ success: true, count: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// --- 5. GET PRESIGNED URL FOR CLIENT-SIDE UPLOAD ---
router.post('/get-upload-url', authenticateToken, async (req, res) => {
  try {
    const { fileName, fileType } = req.body;
    const key = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileName.split('.').pop()}`;

    const client = getS3Client();
    const command = new PutObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
    res.json({ success: true, uploadUrl, key });
  } catch (err) {
    console.error("Presigned URL Error:", err.message);
    res.status(500).json({ success: false, message: "Could not generate upload pass" });
  }
});

// --- 6. CONFIRM CLIENT-SIDE UPLOAD ---
router.post('/confirm-upload', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase(); 
    let retries = 0;
    while (mongoose.connection.readyState !== 1 && retries < 4) {
      await new Promise(resolve => setTimeout(resolve, 500));
      retries++;
    }

    const { receiverId, text, fileUrl, fileType } = req.body;
    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    const senderModel = req.user.role === 'agent' ? 'Agent' : 'User';

    const newMessage = new Message({
      senderId: req.user.id,
      senderModel,
      receiverId,
      receiverModel,
      text: text || "",
      fileUrl, 
      fileType,
      status: 'sent',
      notificationSent: false
    });
    await newMessage.save();

    // Resolve pre-signed secure URL mapping
    const signedUrlForFrontend = await getPrivateUrl(fileUrl);
    const outputPayload = { ...newMessage.toObject(), fileUrl: signedUrlForFrontend };

    // --- NOTIFICATION & SOCKET PIPELINE ---
    const TargetModel = receiverModel === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId);
    const sender = await (senderModel === 'Agent' ? Agent : User).findById(req.user.id);
    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    if (receiver?.pushSubscription) {
      const payload = JSON.stringify({
        title: `New ${fileType} from ${sender?.firstName || 'Zing'}`,
        body: text || `Sent an attachment`,
        data: { url: receiverModel === 'Agent' ? '/agent/dashboard' : '/user/dashboard' }
      });
      webpush.sendNotification(receiver.pushSubscription, payload).catch(e => console.error(e));
    }

    if (!isOnline && receiver) {
      const COOLDOWN = 30 * 60 * 1000;
      const lastEmail = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;
      if (Date.now() - lastEmail > COOLDOWN) {
        // FIXED: Standardized signature matching to match your core mailing parameters
        await sendOfflineNotification(receiver, sender, text || `Sent a file asset`, receiverModel);
        await TargetModel.findByIdAndUpdate(receiverId, { lastNotificationEmail: new Date() });
      }
    }

    if (isOnline && io) { 
      io.to(receiverId.toString()).emit("new-message", outputPayload); 
    }

    res.status(201).json({ success: true, message: outputPayload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 7. DELETE MESSAGE ---
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const messageId = req.params.id;
    const myId = req.user.id;
    const message = await Message.findOne({ _id: messageId, senderId: myId });

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found or unauthorized." });
    }
    await Message.findByIdAndDelete(messageId);

    const io = req.app.get('socketio');
    if (io) {
      io.to(message.receiverId.toString()).emit("message-deleted", messageId);
    }

    res.json({ success: true, message: "Message deleted successfully" });
  } catch (err) {
    console.error("Delete Route Error:", err);
    res.status(500).json({ success: false, message: "Server error during deletion" });
  }
});

export default router;