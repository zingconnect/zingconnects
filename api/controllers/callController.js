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
      { new: true }
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

// @desc Updates the WebRTC signal (Handles both the Initial Offer and the Answer)
export const updateCallSignal = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;

    if (!callId || !signal) {
      return res.status(400).json({ success: false, message: "Missing callId or signal data" });
    }

    const call = await Call.findById(callId);
    if (!call) return res.status(404).json({ success: false, message: "Call session not found" });

    // Determine if we are saving the Agent's Offer or the User's Answer
    const isOffer = !call.signal;
    
    const updateData = isOffer 
      ? { signal: signal, status: 'ringing' } 
      : { answerSignal: signal, status: 'connected', startTime: call.startTime || Date.now() };

    const updatedCall = await Call.findByIdAndUpdate(callId, updateData, { new: true });

    const io = req.app.get('socketio');
    if (io) {
      const myId = (req.user.id || req.user._id || req.user.userId).toString();
      const targetId = updatedCall.caller.toString() === myId 
        ? updatedCall.receiver.toString() 
        : updatedCall.caller.toString();

      io.to(targetId).emit(isOffer ? "incoming-call" : "call-accepted", {
        signal: signal,
        callId: callId,
        fromName: req.user.firstName || "User"
      });
    }

    res.json({ success: true, status: updatedCall.status });
  } catch (error) {
    console.error("❌ Signaling Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc User polls this to find active calls and the connection signal
export const checkIncomingCall = async (req, res) => {
  try {
    await connectToDatabase(); 
    const userId = req.user._id || req.user.id;

    const incoming = await Call.findOne({ 
      receiver: userId, 
      status: 'ringing',
      signal: { $ne: null } 
    }).populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });

    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      signal: incoming.signal, 
      createdAt: incoming.createdAt,
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
      { new: true, sort: { createdAt: -1 } }
    );

    // Notify other party via socket if possible
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