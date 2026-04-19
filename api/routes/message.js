import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js'; 
import { authenticateToken } from '../routes/auth.js';

const router = express.Router();

router.get('/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;

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

router.post('/send', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();

    const { receiverId, text, receiverModel } = req.body;
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel: receiverModel || (req.user.role === 'agent' ? 'User' : 'Agent'),
      text
    });

    // 3. Save to MongoDB
    await newMessage.save();

    // 4. Return the new message so the UI can display it immediately
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