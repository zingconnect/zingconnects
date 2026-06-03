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

/**
 * Helper to clear cache consistently
 */
async function clearUserCache(app, modelName, userId) {
  const redis = app.get('redisClient');
  if (redis) {
    await redis.del(`${modelName.toLowerCase()}:${userId}`).catch(() => {});
    await redis.del(`profile:${userId}`).catch(() => {});
  }
}

// 1. GET HISTORY
router.get('/:otherUserId', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { otherUserId } = req.params;
    const { beforeId, limit } = req.query;

    const query = {
      $or: [
        { senderId: req.user.id, receiverId: otherUserId }, 
        { senderId: otherUserId, receiverId: req.user.id }
      ]
    };

    if (beforeId && mongoose.isValidObjectId(beforeId)) {
      const ref = await Message.findById(beforeId).select('createdAt');
      if (ref) query.createdAt = { $lt: ref.createdAt };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit) || 20, 50))
      .lean();

    const finalMessages = await Promise.all(messages.reverse().map(async (m) => {
      if (m.fileUrl && ['image', 'video'].includes(m.fileType)) {
        m.fileUrl = await getPrivateUrl(m.fileUrl);
      }
      return m;
    }));

    res.json({ success: true, messages: finalMessages });
  } catch (err) {
    next(err);
  }
});

// 2. SEND TEXT + PUSH & EMAIL NOTIFICATIONS
router.post('/send', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { receiverId, text, receiverModel, fileType, replyToId } = req.body;
    
    if (!text?.trim() || !receiverId) {
      return res.status(400).json({ success: false, message: "Invalid payload: Text or Recipient missing" });
    }

    // Determine target roles dynamically
    let senderDoc = await Agent.findById(myId) || await User.findById(myId);
    if (!senderDoc) {
      return res.status(404).json({ success: false, message: "Sender identity mismatch." });
    }

    const senderModelName = req.user.role === 'agent' ? 'Agent' : 'User';
    const targetModelName = receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent');

    // Create the message tracking payload
    const newMessage = await Message.create({
      senderId: myId,
      senderModel: senderModelName,
      receiverId,
      receiverModel: targetModelName,
      text: text.trim(),
      fileType: fileType || 'text',
      notificationSent: false
    });

    const TargetModel = targetModelName === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId)
      .select('pushSubscription lastNotificationEmail email firstName lastName');

    if (!receiver) {
      return res.status(404).json({ success: false, message: "Recipient entity match not found." });
    }

    // Distributed Socket handling via Redis adapter checking
    const io = req.app.get('socketio');
    let isOnline = false;
    
    if (io) {
      const sockets = await io.in(receiverId.toString()).fetchSockets();
      isOnline = sockets.length > 0;
      
      if (isOnline) {
        io.to(receiverId.toString()).emit("new-message", {
          id: newMessage._id,
          senderId: newMessage.senderId,
          senderModel: newMessage.senderModel,
          receiverId: newMessage.receiverId,
          receiverModel: newMessage.receiverModel,
          content: newMessage.text,
          fileType: newMessage.fileType,
          createdAt: newMessage.createdAt
        });
      }
    }

    // ====== WEB PUSH NOTIFICATION DISPATCHER ======
    const baseUrl = "https://www.zingconnect.chat";
    const path = targetModelName === 'Agent' ? `/agent/dashboard?userId=${myId}` : `/user/dashboard?agentId=${myId}`;
    const senderName = senderDoc.firstName || senderDoc.email?.split('@')[0] || 'Zing';
    
    const payload = JSON.stringify({
      title: `New Message from ${senderName}`,
      body: text.length > 60 ? `${text.substring(0, 60)}...` : text,
      icon: `${baseUrl}/logo-s.png`,
      badge: `${baseUrl}/logo-s.png`,
      data: { url: `${baseUrl}${path}`, type: 'message' }
    });

    console.log("---------------- PUSH DIAGNOSTIC ----------------");
    console.log("Recipient ID:", receiverId);
    console.log("Recipient Found in DB:", !!receiver);
    console.log("Has pushSubscription:", !!receiver?.pushSubscription);
    console.log("Target Endpoint:", receiver?.pushSubscription?.endpoint || "❌ NONE");
    console.log("-------------------------------------------------");

    if (receiver.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
        console.log(`✅ Push notification sent successfully to ${receiverId}`);
      } catch (pushErr) {
        console.error("❌ PUSH FAILED:", pushErr.message);
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          await TargetModel.findByIdAndUpdate(receiverId, { $unset: { pushSubscription: "" } });
          console.log(`🧹 Cleaned expired subscription out for user ${receiverId}`);
        }
      }
    }

    // ====== OFFLINE EMAIL FALLBACK ROUTINE ======
    try {
      const COOLDOWN = 30 * 60 * 1000;
      const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;
      
      if (Date.now() - lastEmailTime > COOLDOWN) {
        await sendOfflineNotification(receiver, senderDoc, text, targetModelName);
        await TargetModel.findByIdAndUpdate(receiverId, { $set: { lastNotificationEmail: new Date() } });
        console.log(`📧 Offline fallback mail dispatched to ${receiver.email}`);
      }
    } catch (mailErr) {
      console.error("❌ Notification Email Fault:", mailErr.message);
    }

    res.status(201).json({ success: true, message: newMessage });
  } catch (err) {
    next(err);
  }
});

// 3. MARK AS READ
router.patch('/mark-read/:otherUserId', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const result = await Message.updateMany(
      { senderId: req.params.otherUserId, receiverId: req.user.id, status: { $ne: 'seen' } },
      { $set: { status: 'seen', seenAt: new Date() } }
    );
    
    const io = req.app.get('socketio');
    if (io) io.to(req.params.otherUserId).emit("messages-seen", { readerId: req.user.id });

    res.json({ success: true, count: result.modifiedCount });
  } catch (err) {
    next(err);
  }
});

// 4. UPLOAD URL GENERATION
router.post('/get-upload-url', authenticateToken, async (req, res, next) => {
  try {
    const { fileName, fileType } = req.body;
    const key = `chat/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileName.split('.').pop()}`;
    const command = new PutObjectCommand({ Bucket: process.env.IDRIVE_BUCKET_NAME, Key: key, ContentType: fileType });
    const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 900 });
    res.json({ success: true, uploadUrl, key });
  } catch (err) {
    next(err);
  }
});

// 5. CONFIRM UPLOAD
router.post('/confirm-upload', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { receiverId, text, fileUrl, fileType } = req.body;
    const newMessage = await Message.create({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel: req.user.role === 'agent' ? 'User' : 'Agent',
      text: text?.trim() || "",
      fileUrl,
      fileType,
      status: 'sent'
    });

    const signedUrl = await getPrivateUrl(fileUrl);
    res.status(201).json({ success: true, message: { ...newMessage.toObject(), fileUrl: signedUrl } });
  } catch (err) {
    next(err);
  }
});

// 6. DELETE
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const msg = await Message.findOneAndDelete({ _id: req.params.id, senderId: req.user.id });
    if (!msg) return res.status(404).json({ success: false, message: "Not found" });
    
    const io = req.app.get('socketio');
    if (io) io.to(msg.receiverId.toString()).emit("message-deleted", req.params.id);
    
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;