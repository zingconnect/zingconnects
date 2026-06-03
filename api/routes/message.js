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


// 4. UPLOAD URL GENERATION (HARDENED SECURITY MATRIX)
router.post('/get-upload-url', authenticateToken, async (req, res, next) => {
  try {
    const { fileName, fileType } = req.body;
    
    // 🛡️ SECURITY FIX 1: Input Presence Checking
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "File metadata missing." });
    }

    // 🛡️ SECURITY FIX 2: Strict Server-Side Mime-Type White-list Matrix
    // This explicitly maps acceptable content types to safe, single extensions
    const allowedMimeTypes = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov'
    };

    const sanitizedMime = String(fileType).toLowerCase().trim();
    if (!allowedMimeTypes[sanitizedMime]) {
      return res.status(400).json({ 
        success: false, 
        message: "Unsupported file type signature. Only safe images and videos are permitted." 
      });
    }

    // Determine target extension strictly using server mappings instead of trust-matching original extensions
    const safeExtension = allowedMimeTypes[sanitizedMime];
    const uniqueKey = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${safeExtension}`;
    
    const client = getS3Client();
    const command = new PutObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: uniqueKey,
      ContentType: sanitizedMime, // Forces the storage gateway to store it with the correct HTTP content type header
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

    // Return the secure, pre-mapped unique reference token paths back to the client layout
    return res.json({ 
      success: true, 
      uploadUrl, 
      key: uniqueKey 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 4: Prevent raw system file path error traces from escaping out over network responses
    next(err);
  }
});


// 5. CONFIRM UPLOAD (NOW SUPPORTING FULL WEB PUSH + EMAIL NOTIFICATIONS)
router.post('/confirm-upload', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { receiverId, text, fileUrl, fileType } = req.body;

    if (!receiverId || !fileUrl) {
      return res.status(400).json({ success: false, message: "Invalid payload: Target elements missing." });
    }

    // Determine tracking types safely
    const sanitizedType = ['image', 'video'].includes(String(fileType).toLowerCase().trim()) 
      ? String(fileType).toLowerCase().trim() 
      : 'image';

    let senderDoc = await Agent.findById(myId) || await User.findById(myId);
    if (!senderDoc) {
      return res.status(404).json({ success: false, message: "Sender identity mismatch." });
    }

    const senderModelName = req.user.role === 'agent' ? 'Agent' : 'User';
    const targetModelName = req.user.role === 'agent' ? 'User' : 'Agent';

    // 1. Persist the media index message asset
    const newMessage = await Message.create({
      senderId: myId,
      senderModel: senderModelName,
      receiverId,
      receiverModel: targetModelName,
      text: text?.trim() || "",
      fileUrl,
      fileType: sanitizedType,
      status: 'sent',
      notificationSent: false
    });

    const TargetModel = targetModelName === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId)
      .select('pushSubscription lastNotificationEmail email firstName lastName');

    if (!receiver) {
      return res.status(404).json({ success: false, message: "Recipient record mismatch." });
    }

    // 2. Query distributed cluster rooms safely via Redis fetchSockets
    const io = req.app.get('socketio');
    let isOnline = false;
    
    if (io) {
      const sockets = await io.in(receiverId.toString()).fetchSockets();
      isOnline = sockets.length > 0;
    }

    // 3. Generate fallback presentation content bodies for empty message logs
    const dynamicNotificationBody = text?.trim() 
      ? (text.length > 60 ? `${text.substring(0, 60)}...` : text) 
      : (sanitizedType === 'video' ? "🎥 Sent a video attachment" : "📷 Sent an image attachment");

    const baseUrl = "https://www.zingconnect.chat";
    const path = targetModelName === 'Agent' ? `/agent/dashboard?userId=${myId}` : `/user/dashboard?agentId=${myId}`;
    const senderName = senderDoc.firstName || senderDoc.email?.split('@')[0] || 'Zing';

    const payload = JSON.stringify({
      title: `New Attachment from ${senderName}`,
      body: dynamicNotificationBody,
      icon: `${baseUrl}/logo-s.png`,
      badge: `${baseUrl}/logo-s.png`,
      data: { url: `${baseUrl}${path}`, type: 'message' }
    });

    // ====== TEMPORARY MEDIA ATTACHMENT DIAGNOSTIC LOGS ======
    console.log("---------------- CONFIRM UPLOAD PUSH DIAGNOSTIC ----------------");
    console.log("Recipient ID:", receiverId);
    console.log("Target Model Name:", targetModelName);
    console.log("Recipient Found in DB:", !!receiver);
    console.log("Has pushSubscription:", !!receiver?.pushSubscription);
    console.log("Target Endpoint:", receiver?.pushSubscription?.endpoint || "❌ NONE");
    console.log("----------------------------------------------------------------");

    // Execute Web Push dispatch logic
    if (receiver.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
        console.log(`✅ Media Web Push successfully processed for user: ${receiverId}`);
      } catch (pushErr) {
        console.error("❌ MEDIA PUSH COURIER FAILURE:", pushErr.message);
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          await TargetModel.findByIdAndUpdate(receiverId, { $unset: { pushSubscription: "" } });
          console.log(`🧹 Cleaned dead subscription endpoint tracking for user: ${receiverId}`);
        }
      }
    }

    // 4. Trigger fallback offline email courier
    try {
      const COOLDOWN = 30 * 60 * 1000;
      const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;
      
      if (Date.now() - lastEmailTime > COOLDOWN) {
        const attachmentTextFallback = text?.trim() || `Sent an asset attachment (${sanitizedType})`;
        await sendOfflineNotification(receiver, senderDoc, attachmentTextFallback, targetModelName);
        await TargetModel.findByIdAndUpdate(receiverId, { $set: { lastNotificationEmail: new Date() } });
        console.log(`📧 Offline media confirmation fallback mail dispatched to ${receiver.email}`);
      }
    } catch (mailErr) {
      console.error("❌ Media Email Notification Tracker Error:", mailErr.message);
    }

    // 5. Broadcast live update socket streams if online status is met
    const signedUrl = await getPrivateUrl(fileUrl);
    if (isOnline && io) {
      io.to(receiverId.toString()).emit("new-message", {
        id: newMessage._id,
        senderId: newMessage.senderId,
        senderModel: newMessage.senderModel,
        receiverId: newMessage.receiverId,
        receiverModel: newMessage.receiverModel,
        content: newMessage.text,
        fileUrl: signedUrl,
        fileType: newMessage.fileType,
        createdAt: newMessage.createdAt
      });
    }

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