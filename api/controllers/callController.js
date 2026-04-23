import Call from '../models/Call.js';
import { connectToDatabase } from '../index.js'; 

// @desc    Start a call initiation
export const startCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, receiverModel } = req.body;
    
    const callerId = req.user._id || req.user.id || req.user.userId;
    if (!callerId) {
      return res.status(400).json({ message: "Token does not contain a valid User ID" });
    }

    const newCall = new Call({
      caller: callerId,
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

// @desc    Update the WebRTC signal data (CRITICAL: Fixes the 500 error)
export const updateCallSignal = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;

    if (!callId || !signal) {
      return res.status(400).json({ success: false, message: "Missing callId or signal data" });
    }

    await Call.findByIdAndUpdate(callId, { signal: signal });
    res.json({ success: true });
  } catch (error) {
    console.error("Update Signal Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get current status of a specific call
export const getCallStatus = async (req, res) => {
  try {
    await connectToDatabase(); 
    const { callId } = req.params;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" });
    }

    res.json({ 
      success: true, 
      status: call.status,
      signal: call.signal, // Also provide the signal here as a backup
      duration: call.startTime ? Math.floor((Date.now() - call.startTime) / 1000) : 0 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching status" });
  }
};

// @desc    Check for incoming calls (Polling)
export const checkIncomingCall = async (req, res) => {
  try {
    await connectToDatabase(); 
    const userId = req.user._id || req.user.id;

    const incoming = await Call.findOne({ 
      receiver: userId, 
      status: 'ringing' 
    }).populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });

    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      signal: incoming.signal, // CRITICAL: The receiver needs this signal to connect
      callerData: {
        fromName: `${incoming.caller?.firstName || 'Unknown'} ${incoming.caller?.lastName || ''}`,
        photoUrl: incoming.caller?.photoUrl || null,
        callerId: incoming.caller?._id
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Error checking incoming calls", error: error.message });
  }
};

// @desc    Accept an incoming call
export const acceptCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.body;
    
    const call = await Call.findByIdAndUpdate(
      callId, 
      { status: 'connected', startTime: Date.now() }, 
      { new: true }
    );

    res.json({ success: true, call });
  } catch (error) {
    res.status(500).json({ message: "Error accepting call" });
  }
};
// @desc    End/Decline/Cancel call
export const endCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.body;
    const myId = req.user.id || req.user._id || req.user.userId;

    let call;

    if (callId) {
      // Direct update if we have the ID
      call = await Call.findByIdAndUpdate(
        callId, 
        { status: 'ended', endTime: Date.now(), active: false },
        { new: true }
      );
    } else {
      // Fallback: Find the most recent active call for this user
      call = await Call.findOneAndUpdate(
        { 
          $or: [{ caller: myId }, { receiver: myId }],
          status: { $in: ['calling', 'ringing', 'connected'] }
        },
        { status: 'ended', endTime: Date.now(), active: false },
        { new: true, sort: { createdAt: -1 } }
      );
    }

    if (!call) {
      return res.status(404).json({ success: false, message: "No active call found to end" });
    }

    res.json({ success: true, call });
  } catch (error) {
    res.status(500).json({ message: "Error ending call", error: error.message });
  }
};