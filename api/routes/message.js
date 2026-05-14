import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push';
import multer from 'multer';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import { connectToDatabase } from '../config/db.js';
import { getS3Client, getPrivateUrl, PutObjectCommand } from '../config/s3.js';
import { authenticateToken } from './auth.js';
import { sendOfflineNotification } from '../utils/mailer.js';



const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });


// --- UPDATED: GET CHAT HISTORY WITH CALL LOG SUPPORT ---
router.get('/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const myId = req.user.id;
    const { otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid User ID" });
    }

    // 1. Pagination: default to 20 messages
    const limit = parseInt(req.query.limit) || 20;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) // Get newest first
    .limit(limit)
    .lean(); // lean() is critical for performance and editing the object

    // Reverse to display chronological order in the UI
    const displayMessages = messages.reverse();

    const finalMessages = await Promise.all(displayMessages.map(async (m) => {
      // 2. Handle Media Signing (Images/Videos)
      if (m.fileUrl && (m.fileType === 'image' || m.fileType === 'video')) {
        let fileKey = m.fileUrl;
        if (fileKey.includes('idrivee2.com/')) {
          fileKey = fileKey.split('idrivee2.com/').pop().split('/').slice(1).join('/');
        }
        m.fileUrl = await generateSignedUrl(fileKey);
      }

      // 3. Call Logs: No signing needed for callMetadata
      // Because we used .lean(), m.callMetadata is already a plain JSON object.
      
      return m;
    }));

    res.json({ success: true, messages: finalMessages });
  } catch (err) {
    console.error("Chat Load Error:", err);
    res.status(500).json({ success: false, message: "Error loading chat history" });
  }
});

// --- 2. SEND TEXT MESSAGE (HYBRID NOTIFICATION LOGIC) ---
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, receiverModel } = req.body;
    const myId = req.user.id; 
    const senderRole = req.user.role === 'agent' ? 'Agent' : 'User';

    if (!text || !receiverId) {
      return res.status(400).json({ success: false, message: "Text and receiverId are required" });
    }

    const finalReceiverModel = receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent');
    
    // 1. Save Message
    const newMessage = new Message({
      senderId: myId,
      senderModel: senderRole,
      receiverId,
      receiverModel: finalReceiverModel,
      text,
      notificationSent: false
    });
    await newMessage.save();

    // 2. Fetch identities for notifications
    const TargetModel = finalReceiverModel === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId);
    const sender = await (senderRole === 'Agent' ? Agent : User).findById(myId);

    // 3. GET SOCKET STATUS
    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    // --- STEP A: ALWAYS ATTEMPT WEB PUSH (UNLIMITED & FREE) ---
    // This handles background tabs and mobile browsers without hitting Gmail limits.
    if (receiver && receiver.pushSubscription) {
      try {
        const payload = JSON.stringify({
          title: `New Message from ${sender.firstName || 'Zing'}`,
          body: text,
          data: { 
            url: finalReceiverModel === 'Agent' 
              ? `/agent/dashboard?userId=${myId}` 
              : `/user/dashboard?agentId=${myId}` 
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
        console.log(`[Push] Sent to ${receiver.email}`);
      } catch (pushErr) {
        console.error("Push Notification Failed:", pushErr.message);
      }
    }
if (!isOnline && receiver) {
  try {
    const COOLDOWN = 30 * 60 * 1000; 
    const now = Date.now();
    const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

    if (now - lastEmailTime > COOLDOWN) {
      await TargetModel.findByIdAndUpdate(receiverId, { 
        lastNotificationEmail: new Date() 
      });
      await sendOfflineNotification(receiver, sender, text, receiverModel);
      
      console.log(`[Throttle] Cooldown started for ${receiver.email}`);
    }
  } catch (mailErr) {
    console.error("Email Throttle Error:", mailErr.message);
  }
}

    // --- STEP C: REAL-TIME SOCKET EMIT ---
    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", newMessage);
    }

    res.status(201).json({ success: true, message: newMessage });
  } catch (err) {
    console.error("Critical Send Error:", err);
    res.status(500).json({ success: false, message: "Failed to send", error: err.message });
  }
});

router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { receiverId, text } = req.body; 
    
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });

    const mimeType = req.file.mimetype;
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    // 1. Upload to iDrive
    const parallelUploads3 = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: mimeType,
      },
    });
    await parallelUploads3.done();

    // 2. Generate temporary URL for the immediate frontend response
    const signedUrlForFrontend = await generateSignedUrl(fileName);

    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    
    // 3. Create and Save the Message
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel,
      text: text || "", 
      fileUrl: fileName, 
      fileType: detectedType,
      status: 'sent',
      notificationSent: false // Default to false initially
    });

    await newMessage.save();

    // 4. Handle Push Notification & Update Flag
    const responseData = newMessage.toObject();
    responseData.fileUrl = signedUrlForFrontend;

    try {
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);
      
      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New ${detectedType} from ${req.user.firstName || 'Zing'}`,
          body: text ? text : (detectedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo"),
          data: { url: receiverModel === 'Agent' ? `/agent/dashboard?userId=${req.user.id}` : '/user/dashboard' }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
                await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
        responseData.notificationSent = true; 
        console.log(`[Push] Notification sent successfully to ${receiverModel}: ${receiverId}`);
      }
    } catch (pErr) { 
      console.error("Push delivery failed, notificationSent will stay false:", pErr.message); 
    }

    // 5. Final Response
    res.status(201).json({ success: true, message: responseData });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ success: false, error: err.message, message: "Upload failed" });
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

// --- 5. GET DIRECT UPLOAD URL ---
router.post('/get-upload-url', authenticateToken, async (req, res) => {
  try {
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "File metadata missing" });
    }

    const fileExtension = fileName.split('.').pop();
    const key = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    res.json({ success: true, uploadUrl, key });
  } catch (err) {
    console.error("Presigned URL Error:", err);
    res.status(500).json({ success: false, message: "Could not generate upload pass" });
  }
});

router.post('/confirm-upload', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, fileUrl, fileType } = req.body;

    if (!receiverId || !fileUrl) {
      return res.status(400).json({ success: false, message: "Missing receiver ID or file path." });
    }

    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    const senderModel = req.user.role === 'agent' ? 'Agent' : 'User';

    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: senderModel,
      receiverId,
      receiverModel,
      text: text || "",
      fileUrl: fileUrl, 
      fileType: fileType,
      status: 'sent'
    });

    await newMessage.save();

    const signedUrlForFrontend = await generateSignedUrl(fileUrl);
    
    const responseData = newMessage.toObject();
    responseData.fileUrl = signedUrlForFrontend;

    // --- PUSH NOTIFICATION ---
    try {
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);
      
      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New ${fileType} from ${req.user.firstName || 'Zing'}`,
          body: text ? text : (fileType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo"),
          data: { 
            url: receiverModel === 'Agent' 
              ? `/agent/dashboard?userId=${req.user.id}` 
              : '/user/dashboard' 
          }
        });
        webpush.sendNotification(receiver.pushSubscription, payload).catch(() => {});
      }
    } catch (pushErr) {
      console.error("Push Notification Failed:", pushErr);
    }

    res.status(201).json({ success: true, message: responseData });

  } catch (err) {
    console.error("CONFIRMATION ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to save message to database." });
  }
});

// --- 6. DELETE MESSAGE (WITH REAL-TIME SYNC) ---
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const messageId = req.params.id;
    const myId = req.user.id;
    const message = await Message.findOne({ _id: messageId, senderId: myId });

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: "Message not found or unauthorized." 
      });
    }
    await Message.findByIdAndDelete(messageId);

    // 3. Real-time update for the receiver
    // We emit a 'message-deleted' event to the receiver's socket room
    const io = req.app.get('socketio');
    if (io) {
      io.to(message.receiverId.toString()).emit("message-deleted", messageId);
      console.log(`[Socket] Delete event emitted for msg: ${messageId}`);
    }

    res.json({ success: true, message: "Message deleted successfully" });
  } catch (err) {
    console.error("Delete Route Error:", err);
    res.status(500).json({ success: false, message: "Server error during deletion" });
  }
});

export default router;