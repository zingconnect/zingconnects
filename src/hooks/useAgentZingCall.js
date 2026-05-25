import { useState, useEffect, useCallback, useRef } from 'react';

export const useAgentZingCall = (socket, agentId) => {
  const [callStatus, setCallStatus] = useState('idle'); 
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [activeCaller, setActiveCaller] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [lkToken, setLkToken] = useState(null); 

  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isVoiceConversionActive, setIsVoiceConversionActive] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");

  const [callTime, setCallTime] = useState(0);
  const [peerConnected, setPeerConnected] = useState(false);

  const timerRef = useRef(null);
  const ringtoneRef = useRef(null);
  const callingRef = useRef(null);
  const callStatusRef = useRef('idle');
  const activeCallRef = useRef(null);
  const isEndingRef = useRef(false);

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);
  useEffect(() => {
    activeCallRef.current = { activeCaller, selectedUser, isIncomingCall };
  }, [activeCaller, selectedUser, isIncomingCall]);

  // Unified Centralized Media Allocation
  useEffect(() => {
    ringtoneRef.current = new Audio('/sounds/ringtone.mp3');
    callingRef.current = new Audio('/sounds/calling.wav');
    
    ringtoneRef.current.loop = true;
    callingRef.current.loop = true;

    return () => {
      [ringtoneRef, callingRef].forEach(ref => {
        if (ref.current) {
          ref.current.pause();
          ref.current = null;
        }
      });
    };
  }, []);

  // Sync Hardware Alert States with Current Status
  useEffect(() => {
    const rAudio = ringtoneRef.current;
    const cAudio = callingRef.current;
    if (!rAudio || !cAudio) return;

    if (callStatus === 'ringing' && isIncomingCall) {
      cAudio.pause();
      rAudio.play().catch(() => {});
    } else if (callStatus === 'calling' || (callStatus === 'ringing' && !isIncomingCall)) {
      rAudio.pause();
      cAudio.play().catch(() => {});
    } else {
      rAudio.pause();
      cAudio.pause();
      rAudio.currentTime = 0;
      cAudio.currentTime = 0;
    }
  }, [callStatus, isIncomingCall]);

  // Live Timer
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => setCallTime(p => p + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setCallTime(0);
    }
    return () => clearInterval(timerRef.current);
  }, [callStatus]);

  const handleEndCall = useCallback(async () => {
    if (!socket || isEndingRef.current) return;
    if (callStatusRef.current === 'idle') return;

    isEndingRef.current = true;
    const currentMeta = activeCallRef.current;
    const targetId = currentMeta?.isIncomingCall ? currentMeta?.activeCaller?.fromId : currentMeta?.selectedUser?._id;
    const currentCallId = currentMeta?.activeCaller?.callId || currentMeta?.selectedUser?.callId || currentMeta?.selectedUser?.roomName;
    
    setCallStatus('idle');
    setPeerConnected(false);
    setIsIncomingCall(false);
    setActiveCaller(null);
    setSelectedUser(null); 
    setLkToken(null);
    setIsVoiceConversionActive(false);

    if (targetId) {
      socket.emit('end-call', { to: targetId, callId: currentCallId });
    }

    const token = localStorage.getItem('agentToken');
    if (currentCallId && token) {
      try {
        await fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        console.warn("DB teardown error:", e);
      }
    }

    setTimeout(() => { isEndingRef.current = false; }, 1500);
  }, [socket]);

  const handleStartCall = useCallback(async (targetUserId, targetUserData = null) => {
    if (!socket || !agentId) return;
    
    setCallStatus('calling');
    setIsIncomingCall(false);
    setSelectedUser(targetUserData || { _id: targetUserId, firstName: "Secure", lastName: "Line" });

    const token = localStorage.getItem('agentToken'); 
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ receiverId: targetUserId, receiverModel: 'User', voiceId: selectedVoiceId || "natural" })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      if (selectedVoiceId && selectedVoiceId !== "natural") setIsVoiceConversionActive(true);
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
      handleEndCall();
    }
  }, [socket, agentId, selectedVoiceId, handleEndCall]);

  const handleAcceptCall = useCallback(async () => {
    const currentMeta = activeCallRef.current;
    if (!socket || !currentMeta?.activeCaller) return;
    
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
        socket.emit('answer-call', { to: currentMeta.activeCaller.fromId, callId: callId, lkToken: data.lkToken });
      } else {
        throw new Error("Handshake invalid");
      }
    } catch (err) {
      handleEndCall();
    }
  }, [socket, handleEndCall]);

  useEffect(() => {
    if (!socket) return;

    const onCallIncoming = (data) => {
      if (callStatusRef.current !== 'idle' || isEndingRef.current) return;
      setActiveCaller({
        fromId: data.fromId || data.from,
        fromName: data.fromName || `${data.firstName || 'ZingConnect'} ${data.lastName || 'Client'}`.trim(),
        photoUrl: data.photoUrl || '',
        callId: data.callId || data.roomName
      });
      setIsIncomingCall(true);
      setCallStatus('ringing'); 
    };

    const onCallAccepted = (data) => {
      if (isEndingRef.current) return;
      if (data.lkToken) setLkToken(data.lkToken);
      setPeerConnected(true);
      setCallStatus('connected');
    };

    socket.on('incoming-call', onCallIncoming);
    socket.on('call-agent', onCallIncoming); 
    socket.on('answer-call', onCallAccepted);
    socket.on('call-accepted', onCallAccepted);
    socket.on('end-call', handleEndCall);
    socket.on('call-ended', handleEndCall);

    return () => {
      socket.off('incoming-call', onCallIncoming);
      socket.off('call-agent', onCallIncoming);
      socket.off('answer-call', onCallAccepted);
      socket.off('call-accepted', onCallAccepted);
      socket.off('end-call', handleEndCall);
      socket.off('call-ended', handleEndCall);
      clearTimeout(isEndingRef.current);
    };
  }, [socket, handleEndCall]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    callStatus, setCallStatus, isIncomingCall, activeCaller, selectedUser, setSelectedUser,
    lkToken, isMuted, setIsMuted, isSpeakerOn, setIsSpeakerOn, isVoiceConversionActive,
    setIsVoiceConversionActive, selectedVoiceId, setSelectedVoiceId, callTime, peerConnected,
    handleStartCall, handleAcceptCall, handleEndCall, formatTime,
  };
};