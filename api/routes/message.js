import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js'; 
// Since auth.js and messages.js are in the same 'routes' folder:
import { authenticateToken } from './auth.js'; 

const router = express.Router();

// --- GET CHAT HISTORY ---
router.get('/:otherUserId', authenticateToken, async (req, res) => {
  try {
    const myId = req.user.id;
    const { otherUserId } = req.params;

    // Validate ID to prevent Mongoose casting errors
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

// --- SEND MESSAGE ---
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiverId, text, receiverModel } = req.body;

    if (!text || !receiverId) {
      return res.status(400).json({ success: false, message: "Text and receiverId are required" });
    }

    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      // Fallback logic for the receiver model
      receiverModel: receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent'),
      text
    });

    await newMessage.save();

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

export default router;