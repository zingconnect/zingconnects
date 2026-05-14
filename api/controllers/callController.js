import mongoose from 'mongoose';
import Call from '../models/Call.js'; 
import { connectToDatabase } from '../config/db.js';
import Agent from '../models/Agent.js';
import Message from '../models/Message.js';
import { createLiveKitToken } from '../utils/livekitHelper.js';

export const startCall = async (req, res) => {
  console.log("--- 📞 START CALL REQUEST RECEIVED ---");
  try {
    await connectToDatabase();

    const { receiverId, isMasked, voiceId } = req.body;
    
    if (!req.user) {
      console.error("❌ Auth Error: req.user is missing");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const callerId = String(req.user.id || req.user._id).trim();
    const targetId = String(receiverId).trim();

    // 2. Generate Room Name & LiveKit Token
    const roomName = `room_${Date.now()}_${callerId.slice(-4)}`;
    console.log(`> Room: ${roomName} | From: ${callerId} | To: ${targetId}`);

    let token;
    try {
      token = await createLiveKitToken(roomName, callerId);
      console.log("✅ LiveKit Token generated successfully");
    } catch (lkErr) {
      console.error("🔥 LiveKit Helper Error:", lkErr.message);
      return res.status(500).json({ 
        success: false, 
        message: "LiveKit Token Generation Failed", 
        error: lkErr.message 
      });
    }

    // 3. Create DB record. This uses the default export which points to the active DB.
    let newCall;
    try {
      newCall = await Call.create({
        roomName,
        caller: callerId,
        callerModel: req.user.role === 'agent' ? 'Agent' : 'User',
        receiver: targetId,
        receiverModel: req.user.role === 'agent' ? 'User' : 'Agent',
        voiceId: voiceId || null,
        status: 'ringing',
        active: true 
      });
      console.log("✅ DB: Call record saved strictly before response");
    } catch (dbErr) {
      console.error("❌ DB Log Fail:", dbErr.message);
      return res.status(500).json({ success: false, message: "Database failure, call cannot start" });
    }

    const io = req.app.get('socketio');
    if (io) {
      io.to(targetId).emit("incoming-call", {
        fromId: callerId,
        fromName: req.user.firstName || "Secure Caller",
        roomName: roomName,
        isMasked: isMasked || false,
        voiceId: voiceId || null,
        callId: newCall._id
      });
      console.log("✅ Socket signal sent to target");
    }

    console.log("🚀 Success response sent to Client");
    return res.status(201).json({ 
      success: true, 
      lkToken: token, 
      roomName: roomName,
      callId: newCall._id 
    });

  } catch (error) {
    console.error("🔥 CRITICAL CONTROLLER ERROR:", error);
    if (!res.headersSent) {
      return res.status(500).json({ 
        success: false, 
        message: "Internal Server Error during call start", 
        error: error.message 
      });
    }
  }
};

export const acceptCall = async (req, res) => {
  try {
    await connectToDatabase();

    const callId = req.params.callId || req.body.callId; 
    const myId = (req.user.id || req.user._id).toString();

    console.log(`📡 Attempting to accept call for Room/ID: ${callId}`);

    const isObjectId = mongoose.Types.ObjectId.isValid(callId);
    
    const updatedCall = await Call.findOneAndUpdate(
      { 
        $or: [
          { roomName: callId }, 
          { _id: isObjectId ? callId : null }
        ] 
      },
      { status: 'connected', startTime: new Date(), active: true },
      { new: true }
    );

    if (!updatedCall) {
      console.error(`❌ Call record not found for: ${callId}`);
      return res.status(404).json({ success: false, message: "Call record not found" });
    }

    const roomName = updatedCall.roomName;
    const token = await createLiveKitToken(roomName, myId);

    const io = req.app.get('socketio');
    if (io) {
      io.to(updatedCall.caller.toString()).emit("call-accepted", { 
        callId: updatedCall._id,
        roomName: roomName
      });
      console.log(`✅ Socket: 'call-accepted' emitted to ${updatedCall.caller}`);
    }

    res.status(200).json({ 
      success: true, 
      lkToken: token, 
      roomName: roomName 
    });

  } catch (error) {
    console.error("🔥 Accept Call Controller Crash:", error.message);
    res.status(500).json({ success: false, message: "Server error during call acceptance" });
  }
};

export const answerCallSignal = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;
    const myId = (req.user.id || req.user._id).toString();

    const updatedCall = await Call.findByIdAndUpdate(
      callId, 
      { answerSignal: signal, status: 'connected', startTime: Date.now() }, 
      { new: true }
    );

    if (!updatedCall) return res.status(404).json({ message: "Call not found" });

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
    
    const myId = (req.user._id || req.user.id || req.user.userId).toString();
    const signalString = typeof signal === 'object' ? JSON.stringify(signal) : signal;

    const call = await Call.findOne({ _id: callId, active: true });
    if (!call) return res.status(404).json({ success: false, message: "Call not found" });

    const isAnswering = call.receiver.toString() === myId;

    const updateData = isAnswering 
      ? { 
          answerSignal: signal, 
          status: 'connected', 
          startTime: Date.now() 
        } 
      : { signal: signal };

    const updatedCall = await Call.findByIdAndUpdate(callId, updateData, { new: true });
    const socketIo = req.app.get('socketio');
    
    if (socketIo) {
      const targetId = isAnswering ? updatedCall.caller.toString() : updatedCall.receiver.toString();
      const eventName = isAnswering ? "call-accepted" : "incoming-call";
      
      console.log(`📡 Emitting ${eventName} to target: ${targetId}`);
      
      socketIo.to(targetId).emit(eventName, { 
        signal: signalString, 
        callId: updatedCall._id 
      });
    }

    res.json({ 
      success: true, 
      status: updatedCall.status,
      signal: isAnswering ? updatedCall.answerSignal : updatedCall.signal 
    });

  } catch (error) {
    console.error("🔥 Signal Update Crash:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const checkIncomingCall = async (req, res) => {
  try {
    await connectToDatabase(); 
    const userId = (req.user._id || req.user.id).toString();
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);

    const incoming = await Call.findOne({ 
      receiver: userId, 
      status: { $in: ['ringing', 'calling'] },
      active: true,
      createdAt: { $gte: sixtySecondsAgo } 
    })
    .sort({ createdAt: -1 })
    .populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });
    let finalPhotoUrl = incoming.caller?.photoUrl || "/default-avatar.png";
    
    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      status: incoming.status,
      signal: incoming.signal,
      roomName: incoming.roomName, 
      voiceId: incoming.voiceId, 
      callerData: {
        fromName: `${incoming.caller?.firstName || 'Secure'} ${incoming.caller?.lastName || 'Caller'}`.trim(),
        photoUrl: finalPhotoUrl,
        callerId: incoming.caller?._id
      }
    });
  } catch (error) {
    console.error("Check Incoming Error:", error);
    res.status(500).json({ hasIncomingCall: false });
  }
};

export const getCallStatus = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.params; // Using roomName as callId for sharding efficiency

    console.log(`🔍 Querying status for Room: ${callId}`);

    // Lean queries are faster for high-frequency polling
    const call = await Call.findOne({ roomName: callId })
      .select('status active startTime voiceId')
      .lean();

    if (!call) {
      return res.status(200).json({ 
        success: true, 
        status: 'ended', 
        active: false 
      });
    }

    res.json({ 
      success: true, 
      status: call.status,
      active: call.active,
      startTime: call.startTime 
    });

  } catch (error) {
    console.error("🔥 getCallStatus Crash:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Database error checking status",
      error: error.message 
    });
  }
};

export const endCall = async (req, res) => {
  try {
    await connectToDatabase();
    
    const callId = req.params.callId || req.body.callId; 
    const myId = (req.user.id || req.user._id).toString();

    if (!callId) {
      return res.status(400).json({ success: false, message: "No Call ID provided" });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(callId);

    const query = {
      $and: [
        { $or: [{ roomName: callId }, { _id: isObjectId ? callId : null }] },
        { $or: [{ caller: myId }, { receiver: myId }] },
      ]
    };

    const call = await Call.findOneAndUpdate(
      query,
      { 
        status: 'ended', 
        endTime: new Date(), 
        active: false 
      },
      { new: true }
    );

    if (!call) return res.json({ success: true, message: "Call record not found or already handled" });

    const durationSeconds = call.startTime 
      ? Math.floor((new Date() - new Date(call.startTime)) / 1000) 
      : 0;

    const callLogEntry = new Message({
      senderId: call.caller,
      senderModel: call.callerModel,
      receiverId: call.receiver,
      receiverModel: call.receiverModel,
      fileType: 'call_log', 
      text: `Voice Call Ended (${durationSeconds}s)`, 
      callMetadata: { 
        callId: call._id, 
        roomName: call.roomName, 
        status: 'ended', 
        duration: durationSeconds 
      }
    });
    await callLogEntry.save();

    const io = req.app.get('socketio');
    if (io) {
      const targetId = call.caller.toString() === myId 
        ? call.receiver.toString() 
        : call.caller.toString();
      
      io.to(targetId.trim()).emit("call-ended", { roomName: call.roomName, callId: call._id });
      io.to(targetId.trim()).emit("end-call", { roomName: call.roomName, callId: call._id });
      
      io.to(call.caller.toString()).emit("new-message", callLogEntry);
      io.to(call.receiver.toString()).emit("new-message", callLogEntry);
    }

    res.json({ success: true, duration: durationSeconds });
  } catch (error) {
    console.error("🔥 End Call Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const logMissedCall = async (callId, req = null) => {
  try {
    // Ensure we are connected if called as a standalone utility
    await connectToDatabase();

    const call = await Call.findByIdAndUpdate(
      callId, 
      { status: 'missed', active: false }, 
      { new: true }
    );

    if (!call) {
      console.error(`[MissedCall] Call ID ${callId} not found.`);
      return;
    }

    const missedLog = new Message({
      senderId: call.caller,
      senderModel: call.callerModel,
      receiverId: call.receiver,
      receiverModel: call.receiverModel,
      fileType: 'call_log', 
      text: 'Missed Voice Call',
      callMetadata: { 
        callId: call._id, 
        status: 'missed', 
        duration: 0 
      }
    });

    await missedLog.save();

    const io = req?.app?.get('socketio');
    if (io) {
      const callerRoom = call.caller.toString();
      const receiverRoom = call.receiver.toString();

      io.to(callerRoom).emit("new-message", missedLog);
      io.to(receiverRoom).emit("new-message", missedLog);
      io.to(receiverRoom).emit("call-ended", { callId: call._id, status: 'missed' });
    }

    console.log(`✅ Missed call logged for Call: ${callId}`);
    return missedLog;
  } catch (error) {
    console.error("❌ Error in logMissedCall:", error.message);
  }
};