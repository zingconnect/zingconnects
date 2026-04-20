import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push';
import multer from 'multer'; // 1. Import Multer
import { Upload } from "@aws-sdk/lib-storage"; 
import { S3Client } from "@aws-sdk/client-s3";
import Message from '../models/Message.js';
import User from '../models/User.js';
import Agent from '../models/Agent.js';
import { authenticateToken } from './auth.js';



const s3Client = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
  },
});

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });


// --- GET CHAT HISTORY ---
router.get('/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const myId = req.user.id;
    const { otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid User ID" });
    }

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    }).sort({ createdAt: 1 });

    res.json({ success: true, messages });
  } catch (err) {
    console.error("Chat Load Error:", err);
    res.status(500).json({ success: false, message: "Error loading chat history" });
  }
});

// --- SEND MESSAGE (WITH MOBILE PUSH TRIGGER) ---
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, receiverModel } = req.body;

    if (!text || !receiverId) {
      return res.status(400).json({ success: false, message: "Text and receiverId are required" });
    }

    const finalReceiverModel = receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent');

    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel: finalReceiverModel,
      text
    });

    await newMessage.save();

    // --- MOBILE PUSH LOGIC ---
    try {
      const TargetModel = finalReceiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);

if (receiver && receiver.pushSubscription) {
  const payload = JSON.stringify({
    title: `New Message from ${req.user.firstName || 'Zing'}`,
    body: text,
    data: {
      // MATCHING YOUR APP.JSX ROUTES EXACTLY
      url: finalReceiverModel === 'Agent' 
        ? `/agent/dashboard?userId=${req.user.id}` 
        : '/user/dashboard'
    }
  });

        webpush.sendNotification(receiver.pushSubscription, payload)
          .catch(err => console.log("Push failed (User likely offline/expired):", err.message));
      }
    } catch (pushErr) {
      console.error("Notification trigger error:", pushErr);
      // We don't stop the response because the message was successfully saved
    }

    res.status(201).json({ 
      success: true, 
      message: newMessage 
    });

  } catch (err) {
    console.error("POST /send Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send message",
      error: err.message 
    });
  }
});

router.patch('/mark-read/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const myId = req.user.id;
    const { otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid User ID" });
    }

    const result = await Message.updateMany(
      { 
        senderId: otherUserId, 
        receiverId: myId, 
        status: { $ne: 'seen' } 
      },
      { 
        $set: { 
          status: 'seen',
          seenAt: new Date() 
        } 
      }
    );

    res.json({ 
      success: true, 
      message: "Messages marked as read", 
      count: result.modifiedCount 
    });
  } catch (err) {
    console.error("PATCH /mark-read Error:", err);
    res.status(500).json({ success: false, message: "Failed to update message status" });
  }
});

router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { receiverId } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }

    // Detect type (image or video)
    const mimeType = req.file.mimetype;
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';

    // Generate unique name
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    // Upload to iDrive e2
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
    const fileUrl = `${process.env.IDRIVE_ENDPOINT}/${process.env.IDRIVE_BUCKET_NAME}/${fileName}`;
    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel,
      text: "", // Empty for media
      fileUrl: fileUrl,
      fileType: detectedType,
      status: 'sent'
    });

    await newMessage.save();
    try {
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);

      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New ${detectedType} from ${req.user.firstName || 'Zing'}`,
          body: detectedType === 'video' ? "🎥 Sent a video attachment" : "📷 Sent a photo attachment",
          data: {
            url: receiverModel === 'Agent' 
              ? `/agent/dashboard?userId=${req.user.id}` 
              : '/user/dashboard'
          }
        });
        webpush.sendNotification(receiver.pushSubscription, payload).catch(() => {});
      }
    } catch (pErr) { console.error("Push Error:", pErr); }

    res.status(201).json({ success: true, message: newMessage });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ success: false, message: "Upload failed", error: err.message });
  }
});

export default router;