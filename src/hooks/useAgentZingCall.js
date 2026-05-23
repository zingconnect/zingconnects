import { useState, useEffect, useCallback, useRef } from 'react';

export const useAgentZingCall = (socket, agentId) => {
  // --- CORE SYSTEM STATES ---
  const [callStatus, setCallStatus] = useState('idle'); // idle, calling, ringing, connecting, connected
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [activeCaller, setActiveCaller] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [lkToken, setLkToken] = useState(null); // Critical fix for LiveKit room integration

  // --- AUDIO & MODIFIER STATES ---
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isVoiceConversionActive, setIsVoiceConversionActive] = useState(false);

  // --- TIME TRACKING STATES ---
  const [callTime, setCallTime] = useState(0);
  const [peerConnected, setPeerConnected] = useState(false);

  // --- REFS FOR HARDWARE TIMERS & AUDIO ASSETS ---
  const timerRef = useRef(null);
  const ringtoneRef = useRef(null);
  const callStatusRef = useRef('idle');

  // Keep state and ref bound in sync for async socket closure contexts
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // --- INITIALIZE RINGTONE MEDIA ELEMENT ---
  useEffect(() => {
    ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
    ringtoneRef.current.loop = true;

    return () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current = null;
      }
    };
  }, []);

  // --- AUDIO PIPELINE CONTROLS ---
  const playRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.currentTime = 0;
      ringtoneRef.current.play().catch(err => console.log("[useAgentZingCall] Audio playback deferred:", err));
    }
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  }, []);

  // --- LIVE TIMER ENGINE ---
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setCallTime((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setCallTime(0);
    }
    return () => clearInterval(timerRef.current);
  }, [callStatus]);

  // --- INTERACTION LIFECYCLE HANDLERS ---
  const handleStartCall = useCallback(async (targetUserId, targetUserData = null) => {
    if (!socket || !agentId) return;
    console.log(`[useAgentZingCall] Outbound link initiating to user target: ${targetUserId}`);
    
    setCallStatus('calling');
    setIsIncomingCall(false);
    setSelectedUser(targetUserData || { _id: targetUserId, firstName: "Secure", lastName: "Line" });
    playRingtone();

    const token = localStorage.getItem('agentToken'); 

    try {
      // Synchronize backend tracking record instantiation 
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          receiverId: targetUserId,
          receiverModel: 'User',
          voiceId: "natural"
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "User unreachable");

      if (data.lkToken) setLkToken(data.lkToken);

      // ✅ FIX: Pass the real data.callId (the MongoDB document ID) down the socket line!
      socket.emit('call-user', {
        userToCall: targetUserId.toString(),
        roomName: data.roomName,
        fromId: agentId,
        fromName: "Secure Agent",
        callId: data.callId // Used to be data.roomName; changed to database document ID
      });

      // Update local storage tracking mapping if the layout depends on it
      setSelectedUser(prev => prev ? { ...prev, roomName: data.roomName, callId: data.callId } : null);

      setCallStatus('ringing');
    } catch (err) {
      console.error("❌ Agent Call Initialization Error:", err);
      setCallStatus('idle');
      stopRingtone();
    }
  }, [socket, agentId, playRingtone, stopRingtone]);

  const handleEndCall = useCallback(() => {
    if (!socket) return;
    if (callStatusRef.current === 'idle') return;

    const targetId = isIncomingCall ? activeCaller?.fromId : selectedUser?._id;
    // ✅ Safely grab the database ID or the room name context fallback
    const currentCallId = activeCaller?.callId || selectedUser?.callId || selectedUser?.roomName;
    
    console.log(`[useAgentZingCall] Terminating call channel for target payload ID: ${targetId}`);

    stopRingtone();
    setCallStatus('idle');
    setPeerConnected(false);
    setIsIncomingCall(false);
    setActiveCaller(null);
    setSelectedUser(null); // ✅ Reset selected target state on clear down
    setLkToken(null);
    setIsVoiceConversionActive(false);

    if (targetId) {
      socket.emit('end-call', { to: targetId, callId: currentCallId });
      socket.emit('call-ended', { to: targetId, callId: currentCallId });
    }
  }, [socket, isIncomingCall, activeCaller, selectedUser, stopRingtone]);


  const handleAcceptCall = useCallback(async () => {
    if (!socket || !activeCaller) return;
    console.log('[useAgentZingCall] Running inbound call acceptance endpoint...');
    
    stopRingtone();
    setCallStatus('connecting');
    const token = localStorage.getItem('agentToken');
    const callId = activeCaller.callId;

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.success && data.lkToken) {
        setLkToken(data.lkToken);
        setPeerConnected(true);
        setCallStatus('connected');

        // Emits back to User hook listener: socket.on("answer-call")
        socket.emit('answer-call', {
          to: activeCaller.fromId,
          callId: callId,
          lkToken: data.lkToken
        });
      } else {
        throw new Error("Invalid Handshake validation data");
      }
    } catch (err) {
      console.error("Failed to cleanly accept call channel:", err);
      handleEndCall();
    }
  }, [socket, activeCaller, stopRingtone]);

  const handleEndCall = useCallback(() => {
    if (!socket) return;
    const targetId = isIncomingCall ? activeCaller?.fromId : selectedUser?._id;
    const currentCallId = activeCaller?.callId || selectedUser?.roomName;
    console.log(`[useAgentZingCall] Terminating call channel for target payload ID: ${targetId}`);

    stopRingtone();
    setCallStatus('idle');
    setPeerConnected(false);
    setIsIncomingCall(false);
    setActiveCaller(null);
    setLkToken(null);
    setIsVoiceConversionActive(false);

    if (targetId) {
      // Double emitted signatures match both hook variants seamlessly
      socket.emit('end-call', { to: targetId, callId: currentCallId });
      socket.emit('call-ended', { to: targetId, callId: currentCallId });
    }
  }, [socket, isIncomingCall, activeCaller, selectedUser, stopRingtone]);

  // --- REAL-TIME SIGNALLING SUBSCRIPTION HANDLER ---
  useEffect(() => {
    if (!socket) return;

    // Handles user calling agent payload mapping strings
    const onCallIncoming = (data) => {
      console.log('[useAgentZingCall] Received user incoming-call hook payload data:', data);
      
      setActiveCaller({
        fromId: data.fromId || data.from,
        fromName: data.fromName || `${data.firstName || 'ZingConnect'} ${data.lastName || 'Client'}`.trim(),
        photoUrl: data.photoUrl || '',
        callId: data.callId || data.roomName
      });
      
      setIsIncomingCall(true);
      setCallStatus('ringing'); 
      playRingtone();
    };

    const onCallAccepted = (data) => {
      console.log('[useAgentZingCall] Remote end answer handshaking detected.');
      stopRingtone();
      if (data.lkToken) setLkToken(data.lkToken);
      setPeerConnected(true);
      setCallStatus('connected');
    };

    const onCallTerminated = () => {
      console.log('[useAgentZingCall] Remote peer drop hook event intercepted.');
      stopRingtone();
      setCallStatus('idle');
      setPeerConnected(false);
      setIsIncomingCall(false);
      setActiveCaller(null);
      setLkToken(null);
      setIsVoiceConversionActive(false);
    };

    // Parity safety listeners mapping across both schemas to remove channel deadlocks
    socket.on('incoming-call', onCallIncoming);
    socket.on('call-agent', onCallIncoming); 
    
    socket.on('answer-call', onCallAccepted);
    socket.on('call-accepted', onCallAccepted);
    
    socket.on('end-call', onCallTerminated);
    socket.on('call-ended', onCallTerminated);
    socket.on('call-rejected', onCallTerminated);
    socket.on('call_terminated', onCallTerminated);

    return () => {
      socket.off('incoming-call', onCallIncoming);
      socket.off('call-agent', onCallIncoming);
      socket.off('answer-call', onCallAccepted);
      socket.off('call-accepted', onCallAccepted);
      socket.off('end-call', onCallTerminated);
      socket.off('call-ended', onCallTerminated);
      socket.off('call-rejected', onCallTerminated);
      socket.off('call_terminated', onCallTerminated);
    };
  }, [socket, playRingtone, stopRingtone]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    callStatus,
    setCallStatus,
    isIncomingCall,
    activeCaller,
    selectedUser,
    setSelectedUser,
    lkToken, // Exposed cleanly to match AgentContext layouts
    isMuted,
    setIsMuted,
    isSpeakerOn,
    setIsSpeakerOn,
    isVoiceConversionActive,
    setIsVoiceConversionActive,
    callTime,
    peerConnected,
    handleStartCall,
    handleAcceptCall,
    handleEndCall,
    formatTime,
  };
};