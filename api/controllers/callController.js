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

export const updateCallSignal = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;

    if (!callId || !signal) {
      return res.status(400).json({ success: false, message: "Missing callId or signal data" });
    }
    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: "Call session not found" });
    }
    const isOffer = !call.signal;
    
    let updateData = {};
    if (isOffer) {
      updateData = { 
        signal: signal, 
        status: 'ringing' 
      };
      console.log(`📡 Offer Signal saved for call ${callId}. Status: Ringing.`);
    } else {
      updateData = { 
        answerSignal: signal, // We store this separately to keep the original offer intact
        status: 'connected',
        startTime: Date.now() 
      };
      console.log(`🔊 Answer Signal saved for call ${callId}. Status: Connected.`);
    }
    const updatedCall = await Call.findByIdAndUpdate(
      callId, 
      updateData, 
      { new: true }
    );

    const io = req.app.get('socketio');
    if (io) {
      const myId = (req.user.id || req.user._id || req.user.userId).toString();
      const targetId = updatedCall.caller.toString() === myId 
        ? updatedCall.receiver.toString() 
        : updatedCall.caller.toString();

      if (isOffer) {
        io.to(targetId).emit("incoming-call", {
          signal: signal,
          fromId: myId,
          fromName: req.user.name || req.user.firstName || "User",
          callId: callId
        });
      } else {
        io.to(targetId).emit("call-accepted", {
          signal: signal, // This is the answer signal
          callId: callId
        });
      }
    }

    res.json({ 
      success: true, 
      status: updatedCall.status,
      signalType: isOffer ? 'offer' : 'answer' 
    });
    
  } catch (error) {
    console.error("❌ WebRTC Signaling Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
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
export const acceptCall = async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id || req.user._id;
    const { callId, signal } = req.body; // 'signal' here is the User's Answer Signal

    const call = await Call.findOneAndUpdate(
      { _id: callId, receiver: myId },
      { 
        status: 'connected', 
        startTime: Date.now(),
        answerSignal: signal // Store the answer signal from the receiver
      },
      { new: true }
    ).populate('caller', 'firstName lastName');

    if (!call) return res.status(404).json({ success: false, message: "Call not found" });

    console.log(`✅ Call ${callId} accepted. Answer signal stored.`);
    
    res.json({ 
      success: true, 
      initiatorSignal: call.signal // Return the Agent's original signal to the User
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Retrieve the signal (used by Agent to get the User's Answer)
export const getCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;
    const call = await Call.findById(callId);

    if (!call) return res.status(404).json({ message: "Call not found" });

    res.json({ 
      success: true, 
      status: call.status,
      answerSignal: call.answerSignal // Agent needs this to finish handshake
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
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