import Call from '../models/Call.js';
// ADD THIS IMPORT - Adjust the path if your db logic is elsewhere
import { connectToDatabase } from '../index.js'; 

export const startCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, receiverModel } = req.body;
    if (!req.user) {
      return res.status(401).json({ message: "User context missing from request" });
    }
    const callerId = req.user._id || req.user.id || req.user.userId;

    if (!callerId) {
      return res.status(400).json({ message: "Token does not contain a valid User ID" });
    }
    const newCall = new Call({
      caller: callerId, // Use the extracted ID
      callerModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiver: receiverId,
      receiverModel: receiverModel || 'Agent', 
      status: 'ringing'
    });

    await newCall.save();
    res.status(201).json({ success: true, callId: newCall._id });
  } catch (error) {
    console.error("Call Start Error:", error);
    res.status(500).json({ message: "Failed to start call", error: error.message });
  }
};

// @desc    Check for incoming calls (Polling)
export const checkIncomingCall = async (req, res) => {
  try {
    await connectToDatabase(); 

    const incoming = await Call.findOne({ 
      receiver: req.user._id, 
      status: 'ringing' 
    }).populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });

    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      callerData: {
        fromName: `${incoming.caller.firstName} ${incoming.caller.lastName}`,
        photoUrl: incoming.caller.photoUrl
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Error checking incoming calls", error: error.message });
  }
};

// @desc    Accept an incoming call
export const acceptCall = async (req, res) => {
  try {
    await connectToDatabase(); // Added for Vercel safety
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ message: "callId is required" });

    const call = await Call.findByIdAndUpdate(
      callId, 
      { status: 'connected', startTime: Date.now() }, 
      { new: true }
    );

    res.json({ success: true, call });
  } catch (error) {
    res.status(500).json({ message: "Error accepting call", error: error.message });
  }
};

// @desc    End/Decline/Cancel call
export const endCall = async (req, res) => {
  try {
    await connectToDatabase(); // Added for Vercel safety
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ message: "callId is required" });

    await Call.findByIdAndUpdate(callId, { 
      status: 'ended', 
      endTime: Date.now() 
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error ending call", error: error.message });
  }
};