import express from 'express';
import mongoose from 'mongoose';
import webpush from 'web-push'; // Import web-push
import Message from '../models/Message.js';
import User from '../models/User.js';   // Need this to find receiver's phone ID
import Agent from '../models/Agent.js'; // Need this to find receiver's phone ID
import { authenticateToken } from './auth.js';

const router = express.Router();

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
            url: finalReceiverModel === 'Agent' ? '/agent-dashboard/chat' : '/user-dashboard/chat'
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

// --- MARK MESSAGES AS READ ---
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

export default router;