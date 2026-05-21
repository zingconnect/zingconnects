import { useState, useEffect, useCallback, useRef } from 'react';

export const useAgentZingCall = (socket, agentId) => {
  // --- CORE SYSTEM STATES ---
  const [callStatus, setCallStatus] = useState('idle'); // idle, dialing, ringing, connected
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [activeCaller, setActiveCaller] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

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
  const handleStartCall = useCallback((targetUserId, targetUserData = null) => {
    if (!socket) return;
    console.log(`[useAgentZingCall] Outbound link initiating to target user: ${targetUserId}`);
    
    setCallStatus('dialing');
    setIsIncomingCall(false);
    
    // Fallback profile object composition if full object isn't passed down
    setSelectedUser(targetUserData || { _id: targetUserId, firstName: "Secure", lastName: "Line" });
    playRingtone();

    socket.emit('call_initiate', {
      to: targetUserId,
      from: agentId,
      timestamp: new Date()
    });
  }, [socket, agentId, playRingtone]);

  const handleAcceptCall = useCallback(() => {
    if (!socket || !activeCaller) return;
    console.log('[useAgentZingCall] Accepting incoming call request pipeline.');
    
    stopRingtone();
    setCallStatus('connected');
    setPeerConnected(true);

    socket.emit('call_accept', {
      to: activeCaller.fromId,
      from: agentId
    });
  }, [socket, agentId, activeCaller, stopRingtone]);

  const handleEndCall = useCallback(() => {
    if (!socket) return;
    const targetId = isIncomingCall ? activeCaller?.fromId : selectedUser?._id;
    console.log(`[useAgentZingCall] Terminating call channel for target: ${targetId}`);

    stopRingtone();
    setCallStatus('idle');
    setPeerConnected(false);
    setIsIncomingCall(false);
    setActiveCaller(null);
    setIsVoiceConversionActive(false);

    if (targetId) {
      socket.emit('call_terminate', { to: targetId, from: agentId });
    }
  }, [socket, agentId, isIncomingCall, activeCaller, selectedUser, stopRingtone]);

  // --- REAL-TIME SIGNALLING SUBSCRIPTION HANDLER ---
  useEffect(() => {
    if (!socket) return;

    const onCallIncoming = (data) => {
      console.log('[useAgentZingCall] Intercepted call_incoming socket payload:', data);
      
      // MODIFIED: Constructing complete active caller schemas cleanly
      setActiveCaller({
        fromId: data.from,
        fromName: data.fromName || `${data.firstName || 'Secure'} ${data.lastName || 'Client'}`.trim(),
        photoUrl: data.photoUrl || ''
      });
      
      setIsIncomingCall(true);
      setCallStatus('ringing'); // This toggle kicks off your global UI modal expansion immediately
      playRingtone();
    };

    const onCallAccepted = (data) => {
      console.log('[useAgentZingCall] Handshake verification returned success.');
      stopRingtone();
      setCallStatus('connected');
      setPeerConnected(true);
    };

    const onCallTerminated = () => {
      console.log('[useAgentZingCall] Terminate trigger intercepted via network socket.');
      stopRingtone();
      setCallStatus('idle');
      setPeerConnected(false);
      setIsIncomingCall(false);
      setActiveCaller(null);
      setIsVoiceConversionActive(false);
    };

    socket.on('call_incoming', onCallIncoming);
    socket.on('call_accepted', onCallAccepted);
    socket.on('call_terminated', onCallTerminated);

    return () => {
      socket.off('call_incoming', onCallIncoming);
      socket.off('call_accepted', onCallAccepted);
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