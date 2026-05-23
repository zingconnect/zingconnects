import mongoose from 'mongoose';
import Call from '../models/Call.js'; 
import { connectToDatabase } from '../config/db.js';
import Agent from '../models/Agent.js';
import Message from '../models/Message.js';
import { createLiveKitToken } from '../utils/livekitHelper.js';

// ==========================================
// 📞 1. INITIATION (DIAL OUT)
// ==========================================
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

    // Generate pristine tracking layout identifier
    const roomName = `room_${Date.now()}_${callerId.slice(-4)}`;
    console.log(`> Room: ${roomName} | From: ${callerId} | To: ${targetId}`);
    let newCall;
    try {
      newCall = await Call.create({
        roomName,
        caller: callerId,
        callerModel: req.user.role === 'agent' ? 'Agent' : 'User',
        receiver: targetId,
        receiverModel: req.user.role === 'agent' ? 'User' : 'Agent',
        voiceId: voiceId || null,
        status: 'calling',
        active: true 
      });
      console.log("✅ DB: Call record saved strictly before response");
    } catch (dbErr) {
      console.error("❌ DB Log Fail:", dbErr.message);
      return res.status(500).json({ success: false, message: "Database failure, call cannot start" });
    }

    // Immediately push event down the socket wire to alert the client device layout
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

// ==========================================
// ✅ 2. LIFECYCLE: ACCEPT ACTIVE CALL
// ==========================================
export const acceptCall = async (req, res) => {
  try {
    await connectToDatabase();

    const callId = req.params.callId || req.body.callId; 
    const myId = (req.user.id || req.user._id).toString();

    console.log(`📡 Attempting to accept call for Room/ID: ${callId}`);

    const isObjectId = mongoose.Types.ObjectId.isValid(callId);
    
    const updatedCall = await Call.findOneAndUpdate(
      { 
        $and: [
          { $or: [{ roomName: callId }, { _id: isObjectId ? callId : null }] },
          { receiver: myId }
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

    // Proxy layout clearing parameters over web sockets to synchronize screens instantly
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

// ==========================================
// 🔍 3. DISCOVERY: ACCELERATED BACKGROUND POLLING
// ==========================================
export const checkIncomingCall = async (req, res) => {
  try {
    await connectToDatabase(); 
    const userId = (req.user._id || req.user.id).toString();
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);

    // Fetch memory cache from express application context
    const terminatingCallsCache = req.app.get('terminatingCallsCache');

    const incoming = await Call.findOne({ 
      receiver: userId, 
      status: { $in: ['ringing', 'calling', 'connected'] }, // Keep track safely
      active: true,
      createdAt: { $gte: sixtySecondsAgo } 
    })
    .sort({ createdAt: -1 })
    .populate('caller', 'firstName lastName photoUrl');

    // If absolutely no documents matched
    if (!incoming) return res.json({ hasIncomingCall: false });
    
    // ✅ THE SHIELD: If this call ID was marked as dead in memory, ignore MongoDB and return false
    if (terminatingCallsCache && terminatingCallsCache.has(incoming._id.toString())) {
      console.log(`🛡️ Intercepted race condition: Call ${incoming._id} is terminating. Blocking poller.`);
      return res.json({ hasIncomingCall: false });
    }

    let finalPhotoUrl = incoming.caller?.photoUrl || "/default-avatar.png";
    
    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      status: incoming.status,
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

// ==========================================
// 📊 4. DISCOVERY: FETCH CALL METRICS
// ==========================================
export const getCallStatus = async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.params;

    const terminatingCallsCache = req.app.get('terminatingCallsCache');
    const isObjectId = mongoose.Types.ObjectId.isValid(callId);

    // ✅ Quick catch: if the checked ID is currently cached as dead, resolve 'ended' instantly
    if (isObjectId && terminatingCallsCache && terminatingCallsCache.has(callId.toString())) {
      return res.status(200).json({ success: true, status: 'ended', active: false });
    }

    console.log(`🔍 Querying status for Room: ${callId}`);

    const call = await Call.findOne({
      $or: [
        { roomName: callId },
        { _id: isObjectId ? callId : null }
      ]
    })
    .select('status active startTime voiceId')
    .lean();

    if (!call || (terminatingCallsCache && terminatingCallsCache.has(call._id.toString()))) {
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

// ==========================================
// 📴 5. LIFECYCLE: UNIFIED TERMINATION PIPELINE
// ==========================================
export const endCall = async (req, res) => {
  try {
    await connectToDatabase();
    
    const callId = req.params.callId || req.body.callId; 
    const myId = (req.user.id || req.user._id).toString();

    if (!callId) {
      return res.status(400).json({ success: false, message: "No Call ID provided" });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(callId);

    // ✅ INSTANT MEMORY BLOCK: Stop fallback interval handlers before hitting DB
    const terminatingCallsCache = req.app.get('terminatingCallsCache');
    if (terminatingCallsCache) {
      if (isObjectId) {
        terminatingCallsCache.add(callId.toString());
      }
      // If client sent roomName string instead, cache it dynamically on database discovery below
    }

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

    // Fallback sync for caching if query used roomName string
    if (terminatingCallsCache) {
      terminatingCallsCache.add(call._id.toString());
    }

    const durationSeconds = call.startTime 
      ? Math.floor((new Date() - new Date(call.startTime)) / 1000) 
      : 0;

    // Single point of logging to guarantee zero duplicated logs in the message panel
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

// ==========================================
// 🕒 6. UTILITY: FALLBACK TIMEOUT LOGGER
// ==========================================
export const logMissedCall = async (callId, req = null) => {
  try {
    await connectToDatabase();

    // Cache it if utility handles timeout execution drops
    const terminatingCallsCache = req?.app?.get('terminatingCallsCache');
    if (terminatingCallsCache && callId) {
      terminatingCallsCache.add(callId.toString());
    }

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