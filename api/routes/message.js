import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push';
import multer from 'multer';
import { Upload } from "@aws-sdk/lib-storage"; 
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"; // Added GetObjectCommand
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; // Added getSignedUrl
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

// --- HELPER FUNCTION FOR SIGNED URLS ---
const generateSignedUrl = async (key) => {
  if (!key) return null;
  if (key.startsWith('http')) return key;
  const command = new GetObjectCommand({
    Bucket: process.env.IDRIVE_BUCKET_NAME,
    Key: key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
};

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
    }).sort({ createdAt: 1 }).lean(); // Use lean() for faster processing/editing

    // Generate signed URLs for all media messages
    const signedMessages = await Promise.all(messages.map(async (m) => {
      if (m.fileUrl && (m.fileType === 'image' || m.fileType === 'video')) {
        m.fileUrl = await generateSignedUrl(m.fileUrl);
      }
      return m;
    }));

    res.json({ success: true, messages: signedMessages });
  } catch (err) {
    console.error("Chat Load Error:", err);
    res.status(500).json({ success: false, message: "Error loading chat history" });
  }
});

// --- SEND MESSAGE (TEXT ONLY) ---
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

    try {
      const TargetModel = finalReceiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);
      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New Message from ${req.user.firstName || 'Zing'}`,
          body: text,
          data: {
            url: finalReceiverModel === 'Agent' ? `/agent/dashboard?userId=${req.user.id}` : '/user/dashboard'
          }
        });
        webpush.sendNotification(receiver.pushSubscription, payload).catch(() => {});
      }
    } catch (pushErr) { console.error("Push Error:", pushErr); }

    res.status(201).json({ success: true, message: newMessage });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to send", error: err.message });
  }
});

// --- UPLOAD MEDIA (IMAGE/VIDEO) ---
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { receiverId } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });

    const mimeType = req.file.mimetype;
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    // Upload to iDrive
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

    // Create a working temporary link for the immediate frontend response
    const signedUrlForFrontend = await generateSignedUrl(fileName);

    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel,
      text: "", 
      fileUrl: fileName, // Save the KEY, not the full URL
      fileType: detectedType,
      status: 'sent'
    });

    await newMessage.save();

    // Prepare response with the working link
    const responseData = newMessage.toObject();
    responseData.fileUrl = signedUrlForFrontend;

    // Push Notification logic
    try {
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);
      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New ${detectedType} from ${req.user.firstName || 'Zing'}`,
          body: detectedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo",
          data: { url: receiverModel === 'Agent' ? `/agent/dashboard?userId=${req.user.id}` : '/user/dashboard' }
        });
        webpush.sendNotification(receiver.pushSubscription, payload).catch(() => {});
      }
    } catch (pErr) { console.error("Push Error:", pErr); }

    res.status(201).json({ success: true, message: responseData });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
});

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

export default router;