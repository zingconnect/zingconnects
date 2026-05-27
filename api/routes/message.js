import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; 
import { connectToDatabase } from '../config/db.js';
import { getS3Client, getPrivateUrl, PutObjectCommand } from '../config/s3.js';
import { authenticateToken } from './auth.js';
import { sendOfflineNotification } from '../utils/mailer.js';

const router = express.Router();


router.get('/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    const { beforeId, limit } = req.query;

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

    const parsedLimit = Math.min(parseInt(limit) || 20, 50); // Performance safeguard cap
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
    await connectToDatabase();
    const { receiverId, text, receiverModel } = req.body;
    const myId = req.user.id; 
    const senderRole = req.user.role === 'agent' ? 'Agent' : 'User';

    if (!text || !receiverId) {
      return res.status(400).json({ success: false, message: "Text and receiverId are required" });
    }

    const finalReceiverModel = receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent');
    
    // 1. Create and Save Message (Ensures persistence ahead of side-effects)
    const newMessage = new Message({
      senderId: myId,
      senderModel: senderRole,
      receiverId,
      receiverModel: finalReceiverModel,
      text,
      notificationSent: false
    });
    await newMessage.save();

    // Dynamically retrieve model blueprints from the Mongoose registry
    const TargetModel = finalReceiverModel === 'Agent' ? mongoose.model('Agent') : mongoose.model('User');
    const SenderModel = senderRole === 'Agent' ? mongoose.model('Agent') : mongoose.model('User');

    // 2. Fetch Profiles from Cache/DB via helper contexts
    let receiver = null;
    let sender = null;
    try {
      receiver = await getUserProfileCached(receiverId, TargetModel, finalReceiverModel.toLowerCase());
      sender = await getUserProfileCached(myId, SenderModel, senderRole.toLowerCase());
    } catch (cacheErr) {
      console.warn("⚠️ Profile resolution fallback:", cacheErr.message);
      // Absolute fallback if cache helpers fail under serverless cold-starts
      receiver = await TargetModel.findById(receiverId).lean();
      sender = await SenderModel.findById(myId).lean();
    }

    // 3. Safe Socket Instance Checks for Vercel
    const io = req.app.get('socketio');
    let isOnline = false;
    if (io && io.sockets && io.sockets.adapter) {
      isOnline = io.sockets.adapter.rooms.has(receiverId.toString());
    }

    // 4. --- WEB PUSH ENGAGEMENT ENGINE ---
    if (receiver?.pushSubscription) {
      try {
        if (typeof webpush !== 'undefined') {
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
          newMessage.notificationSent = true;
        }
      } catch (pushErr) {
        console.error("Push Notification Failed:", pushErr.message);
      }
    }

    // 5. --- EMAIL OFFLINE NOTIFICATION ENGINE ---
    if (!isOnline && receiver) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const now = Date.now();
        const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (now - lastEmailTime > COOLDOWN) {
          // FIX: Pull down Redis from the app context interface safely to avoid runtime crashes
          const redisClient = req.app.get('redisClient');
          if (redisClient) {
            // Clear both potential key schemas to prevent un-synced cache mutations
            await redisClient.del(`${finalReceiverModel.toLowerCase()}:${receiverId}`).catch(() => {});
            await redisClient.del(`profile:${receiverId}`).catch(() => {});
          }

          await TargetModel.findByIdAndUpdate(receiverId, { lastNotificationEmail: new Date() });
          
          if (typeof sendOfflineNotification === 'function') {
            await sendOfflineNotification(receiver, sender, text, finalReceiverModel);
          }
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    // 6. --- REAL-TIME SERVER EMIT ---
    if (isOnline && io) {
      try {
        io.to(receiverId.toString()).emit("new-message", newMessage);
      } catch (emitErr) {
        console.error("Serverless WS propagation bypassed:", emitErr.message);
      }
    }

    // 7. --- INSTANT API RETURN TRACER ---
    return res.status(201).json({ success: true, message: newMessage });

  } catch (err) {
    console.error("Critical Send Error:", err);
    return res.status(500).json({ success: false, message: "Failed to send", error: err.message });
  }
});

// --- 3. MARK AS READ ---
router.patch('/mark-read/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    const result = await Message.updateMany(
      { senderId: otherUserId, receiverId: myId, status: { $ne: 'seen' } },
      { $set: { status: 'seen', seenAt: new Date() } }
    );
    
    const io = req.app.get('socketio');
    if (io) {
      io.to(otherUserId.toString()).emit("messages-seen", { readerId: myId });
    }

    res.json({ success: true, count: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// --- 4. GET PRESIGNED URL FOR CLIENT-SIDE UPLOAD ---
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

// --- 5. CONFIRM CLIENT-SIDE UPLOAD ---
router.post('/confirm-upload', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase(); 
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

    const signedUrlForFrontend = await getPrivateUrl(fileUrl);
    const outputPayload = { ...newMessage.toObject(), fileUrl: signedUrlForFrontend };

    const TargetModel = receiverModel === 'Agent' ? Agent : User;
    const SenderModel = senderModel === 'Agent' ? Agent : User;

    // HIGH SPEED CACHE: Pull metadata instantly from memory cache instead of executing heavy queries
    const receiver = await getUserProfileCached(receiverId, TargetModel, receiverModel.toLowerCase());
    const sender = await getUserProfileCached(req.user.id, SenderModel, senderModel.toLowerCase());

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
        await redis.del(`${receiverModel.toLowerCase()}:${receiverId}`);
        await TargetModel.findByIdAndUpdate(receiverId, { lastNotificationEmail: new Date() });
        await sendOfflineNotification(receiver, sender, text || `Sent a file asset`, receiverModel);
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

// --- 6. DELETE MESSAGE ---
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
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