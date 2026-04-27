import Call from '../models/Call.js';
import { connectToDatabase } from '../index.js'; 

// @desc Start a call initiation (Saves the Agent's Offer Signal immediately)
export const startCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, receiverModel, signal } = req.body; 
    
    const callerId = req.user._id || req.user.id || req.user.userId;
    if (!callerId) {
      return res.status(400).json({ message: "Token does not contain a valid User ID" });
    }

    const newCall = new Call({
      caller: callerId,
      callerModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiver: receiverId,
      receiverModel: receiverModel || 'Agent', 
      status: 'ringing', 
      signal: signal 
    });

    await newCall.save();

    const io = req.app.get('socketio');
    if (io) {
      io.to(receiverId.toString()).emit("incoming-call", {
        signal,
        fromId: callerId,
        fromName: req.user.firstName || "Secure Caller",
        callId: newCall._id
      });
    }

    res.status(201).json({ success: true, callId: newCall._id });
  } catch (error) {
    console.error("Call Start Error:", error);
    res.status(500).json({ message: "Failed to start call", error: error.message });
  }
};

// @desc Receiver accepts the call - Updates status to 'connected'
export const acceptCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.body;

    if (!callId) {
      return res.status(400).json({ success: false, message: "Call ID is required" });
    }

   const updatedCall = await Call.findByIdAndUpdate(
  callId,
  { status: 'connected', startTime: Date.now() },
  { returnDocument: 'after' } // replaces new: true
);

    if (!updatedCall) {
      return res.status(404).json({ success: false, message: "Call session not found" });
    }

    // Notify the caller that the call was accepted via Socket
    const io = req.app.get('socketio');
    if (io) {
      const targetId = updatedCall.caller.toString();
      io.to(targetId).emit("call-accepted", { callId: updatedCall._id });
    }

    res.status(200).json({ success: true, status: updatedCall.status });
  } catch (error) {
    console.error("❌ Accept Call Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Optimized: Specifically for the Receiver sending their Answer signal back
export const answerCallSignal = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;
    const myId = (req.user.id || req.user._id).toString();

    // 1. Update DB so the Caller can poll for this answer if socket fails
    const updatedCall = await Call.findByIdAndUpdate(
      callId, 
      { answerSignal: signal, status: 'connected', startTime: Date.now() }, 
      { new: true }
    );

    if (!updatedCall) return res.status(404).json({ message: "Call not found" });

    // 2. Emit to the ORIGINAL caller
    const io = req.app.get('socketio');
    if (io) {
      io.to(updatedCall.caller.toString()).emit("call-accepted", {
        signal: signal,
        callId: callId
      });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCallSignal = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;
    const myId = (req.user.id || req.user._id).toString(); // Ensure string

    const call = await Call.findById(callId);
    if (!call) return res.status(404).json({ success: false, message: "Call not found" });

    // FIX: Ensure both are strings for comparison
    const isAnswering = call.receiver.toString() === myId;

    const updateData = isAnswering 
      ? { answerSignal: signal, status: 'connected', startTime: Date.now() } 
      : { signal: signal, status: 'ringing' };

    const updatedCall = await Call.findByIdAndUpdate(callId, updateData, { new: true });

    const io = req.app.get('socketio');
    if (io) {
      const targetId = isAnswering ? updatedCall.caller.toString() : updatedCall.receiver.toString();
      
      const eventName = isAnswering ? "call-accepted" : "incoming-call";
      
      io.to(targetId).emit(eventName, {
        signal: signal,
        callId: callId,
        fromName: req.user.firstName || "Secure Connection"
      });
    }

    res.json({ success: true, status: updatedCall.status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const checkIncomingCall = async (req, res) => {
  try {
    await connectToDatabase(); 
    const userId = req.user._id || req.user.id;

    const incoming = await Call.findOne({ 
      receiver: userId, 
      status: { $in: ['ringing', 'calling'] }, // Check both states
      active: true 
    })
    .sort({ createdAt: -1 })
    .populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });

    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      status: incoming.status,
      signal: incoming.signal, 
      callerData: {
        fromName: `${incoming.caller?.firstName || 'Unknown'} ${incoming.caller?.lastName || ''}`.trim(),
        photoUrl: incoming.caller?.photoUrl || null,
        callerId: incoming.caller?._id // IMPORTANT: handleAcceptCall needs this!
      }
    });
  } catch (error) {
    res.status(500).json({ hasIncomingCall: false });
  }
};

// @desc Agent/Caller polls this to see if the User has answered yet
export const getCallStatus = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.params;
    const call = await Call.findById(callId);

    if (!call) return res.status(404).json({ message: "Call not found" });

    res.json({ 
      success: true, 
      status: call.status,
      answerSignal: call.answerSignal 
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc Terminates the call session
export const endCall = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.body;
    const myId = req.user.id || req.user._id || req.user.userId;

    const query = callId 
      ? { _id: callId } 
      : { $or: [{ caller: myId }, { receiver: myId }], status: { $ne: 'ended' } };

   const call = await Call.findOneAndUpdate(
  query,
  { status: 'ended', endTime: Date.now(), active: false },
  { 
    returnDocument: 'after', // replaces new: true
    sort: { createdAt: -1 } 
  }
);

    const io = req.app.get('socketio');
    if (io && call) {
      const otherPartyId = call.caller.toString() === myId.toString() ? call.receiver : call.caller;
      io.to(otherPartyId.toString()).emit("call-ended", { callId: call._id });
    }

    res.json({ success: true, message: "Call terminated" });
  } catch (error) {
    console.error("❌ End Call Error:", error);
    res.status(500).json({ message: "Error ending call", error: error.message });
  }
};