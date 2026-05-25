import { useState, useEffect, useCallback, useRef } from 'react';

export const useAgentZingCall = (socket, agentId) => {
  // --- CORE SYSTEM STATES ---
  const [callStatus, setCallStatus] = useState('idle'); // idle, calling, ringing, connecting, connected
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [activeCaller, setActiveCaller] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [lkToken, setLkToken] = useState(null); 

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
  const activeCallRef = useRef(null);
  
  // High-priority hardware flag to drop bounced socket frames during teardowns
  const isEndingRef = useRef(false);

  // Keep state and ref bound in sync for async socket closure contexts
  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  // Maintain active call meta references for exact session isolation checks
  useEffect(() => {
    activeCallRef.current = { activeCaller, selectedUser, isIncomingCall };
  }, [activeCaller, selectedUser, isIncomingCall]);

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

  // Unified, Explicit Termination Engine
  const handleEndCall = useCallback(() => {
    if (!socket) return;
    if (callStatusRef.current === 'idle' && !isEndingRef.current) return;

    // Set immediate lock to throw out incoming echo loops
    isEndingRef.current = true;

    const currentMeta = activeCallRef.current;
    const targetId = currentMeta?.isIncomingCall ? currentMeta?.activeCaller?.fromId : currentMeta?.selectedUser?._id;
    const currentCallId = currentMeta?.activeCaller?.callId || currentMeta?.selectedUser?.callId || currentMeta?.selectedUser?.roomName;
    
    console.log(`[useAgentZingCall] Terminating call channel for target payload ID: ${targetId}`);

    // Stop loops before setting states to avoid UI race conditions
    stopRingtone();
    
    // Explicit clean-slate scrub
    setCallStatus('idle');
    setPeerConnected(false);
    setIsIncomingCall(false);
    setActiveCaller(null);
    setSelectedUser(null); 
    setLkToken(null);
    setIsVoiceConversionActive(false);

    if (targetId) {
      socket.emit('end-call', { to: targetId, callId: currentCallId });
      socket.emit('call-ended', { to: targetId, callId: currentCallId });
    }

    // Release signaling lock after UI engine shifts and stabilizes
    setTimeout(() => {
      isEndingRef.current = false;
    }, 1500);
  }, [socket, stopRingtone]);

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

      socket.emit('call-user', {
        userToCall: targetUserId.toString(),
        roomName: data.roomName,
        fromId: agentId,
        fromName: "Secure Agent",
        callId: data.callId 
      });

      setSelectedUser(prev => prev ? { ...prev, roomName: data.roomName, callId: data.callId } : null);
      setCallStatus('ringing');
    } catch (err) {
      console.error("❌ Agent Call Initialization Error:", err);
      handleEndCall();
    }
  }, [socket, agentId, playRingtone, handleEndCall]);

  const handleAcceptCall = useCallback(async () => {
    const currentMeta = activeCallRef.current;
    if (!socket || !currentMeta?.activeCaller) return;
    console.log('[useAgentZingCall] Running inbound call acceptance endpoint...');
    
    stopRingtone();
    setCallStatus('connecting');
    const token = localStorage.getItem('agentToken');
    const callId = currentMeta.activeCaller.callId;

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

        socket.emit('answer-call', {
          to: currentMeta.activeCaller.fromId,
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
  }, [socket, stopRingtone, handleEndCall]);

  // --- REAL-TIME SIGNALLING SUBSCRIPTION HANDLER ---
  useEffect(() => {
    if (!socket) return;

    const onCallIncoming = (data) => {
      // CRITICAL GUARD: Drop event frame if core pipeline is transitioning or busy
      if (callStatusRef.current !== 'idle' || isEndingRef.current) {
        console.log('[useAgentZingCall] Dropping inbound event loop bounce. Channel Busy.');
        return;
      }
      
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
      if (isEndingRef.current) return;
      console.log('[useAgentZingCall] Remote end answer handshaking detected.');
      stopRingtone();
      if (data.lkToken) setLkToken(data.lkToken);
      setPeerConnected(true);
      setCallStatus('connected');
    };

    const onCallTerminated = () => {
      console.log('[useAgentZingCall] Remote peer drop hook event intercepted.');
      handleEndCall();
    };

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
  }, [socket, playRingtone, stopRingtone, handleEndCall]); // Included handleEndCall dependency here

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return {
    callStatus,
    setCallStatus,
    isIncomingCall,
    activeCaller,
    selectedUser,
    setSelectedUser,
    lkToken, 
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