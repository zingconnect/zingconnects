import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useAgentZingCall(socket, messagesEndRef) {
  const navigate = useNavigate();

  // Core Call States
  const [callStatus, setCallStatus] = useState('idle');
  const [activeCall, setActiveCall] = useState(null);
  const [activeCaller, setActiveCaller] = useState(null);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [liveKitToken, setLiveKitToken] = useState(null);
  
  // Audio Engine Controls
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callTime, setCallTime] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [agentData, setAgentData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Structural Synchronization References
  const callStatusRef = useRef('idle');
  const activeCallRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const pollingRef = useRef(null);
  const audioCtxRef = useRef(null);
  const nextStartTimeRef = useRef(0);

  // Sound Assets
  const ringtoneAudio = useRef(new Audio('/sounds/ringtone.mp3'));
  const callingAudio = useRef(new Audio('/sounds/calling.wav'));
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

  // Secure Audio Subsystem Awake Handle
  const unlockAudio = useCallback(() => {
    if (hasInteracted) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const tempCtx = new AudioContext();
      if (tempCtx.state === 'suspended') tempCtx.resume();
    }
    const silentPlayer = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
    silentPlayer.play().then(() => { silentPlayer.pause(); setHasInteracted(true); }).catch(() => {});
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) { remoteAudio.play().then(() => remoteAudio.pause()).catch(() => {}); }
  }, [hasInteracted]);

  useEffect(() => {
    if (!hasInteracted) {
      window.addEventListener('click', unlockAudio);
      window.addEventListener('touchstart', unlockAudio);
    }
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [hasInteracted, unlockAudio]);

  // Teardown Agent Hardware Resources
  const terminateLocalSession = useCallback(() => {
    setIsEnding(true);
    [ringtoneAudio, callingAudio].forEach(ref => { if (ref?.current) { ref.current.pause(); ref.current.currentTime = 0; } });
    setLiveKitToken(null);
    setCallStatus('idle');
    setIsIncomingCall(false);
    setActiveCall(null);
    setActiveCaller(null);
    setCallTime(0);
    setPeerConnected(false);
    setTimeout(() => setIsEnding(false), 2000);
  }, []);

  // Structural Agent Hangup Method
  const handleEndCall = useCallback(async () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    const myId = agentData?._id || agentData?.id;
    const currentCallId = activeCallRef.current?.callId || activeCallRef.current?._id || activeCallRef.current?.roomName;
    const token = localStorage.getItem('agentToken');
    const targetId = activeCallRef.current?.fromId === myId ? activeCallRef.current?.toId : activeCallRef.current?.fromId;

    try {
      if (currentCallId && token) {
        await fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
      }
      if (socket && targetId) {
        socket.emit("end-call", { to: targetId.toString().trim(), callId: currentCallId });
        socket.off("ai-audio-chunk");
      }
    } catch { console.warn("Teardown handling network error"); }
    finally { terminateLocalSession(); }
  }, [socket, agentData, terminateLocalSession]);

  // Structural Agent Reject Method
  const handleRejectCall = useCallback(async () => {
    console.log("🚫 Agent rejecting incoming client connection...");
    const currentCall = activeCallRef.current || activeCall;
    if (!currentCall) { handleEndCall(); return; }

    const callId = currentCall.callId || currentCall._id || currentCall.roomName;
    const myId = agentData?._id?.toString();
    const targetId = currentCall.fromId?.toString();

    if (socket && targetId && callId) {
      socket.emit("reject-call", { to: targetId, fromId: myId, callId: String(callId).trim() });
    }
    handleEndCall();
  }, [socket, agentData, activeCall, handleEndCall]);

  // Agent Accepts Inbound Route Pipeline
  const handleAcceptCall = useCallback(async () => {
    const token = localStorage.getItem('agentToken');
    const callId = activeCall?.callId || activeCall?._id || activeCall?.roomName;
    if (!callId) return;

    try {
      setIsEnding(false);
      isTransitioningRef.current = true;
      setCallStatus('connecting');

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success && data.lkToken) {
        const userId = (activeCall?.fromId || activeCall?.callerData?.callerId)?.toString();
        if (socket && userId) {
          socket.emit("answer-call", { to: userId, callId: data.roomName || callId, myId: agentData?._id?.toString() });
        }
        setPeerConnected(true);
        setLiveKitToken(data.lkToken);
        isTransitioningRef.current = false;
        setIsIncomingCall(false);
      } else { throw new Error(); }
    } catch {
      isTransitioningRef.current = false;
      handleEndCall();
    }
  }, [activeCall, agentData, socket, handleEndCall]);

  // System Engine Messaging Synchronization Layer
  useEffect(() => {
    if (!socket) return;
    socket.on("new-message", (msg) => {
      setMessages(prev => {
        if (prev.some(m => m._id === msg._id || m.tempId === msg._id)) return prev;
        if (msg.senderModel === 'User' && notificationSound.current) { notificationSound.current.play().catch(() => {}); }
        return [...prev, msg];
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    socket.on("message-deleted", (id) => setMessages(prev => prev.filter(m => (m._id || m.id) !== id)));
    return () => { socket.off("new-message"); socket.off("message-deleted"); };
  }, [socket, messagesEndRef]);

  // Inbound Interface Connection Loop Handshaking Matrix
  useEffect(() => {
    if (!socket || !agentData?._id) return;
    const myId = agentData._id.toString();
    socket.emit("join-main-room", myId);

    const onIncoming = (data) => {
      if (callStatusRef.current !== 'idle' || isEnding || isTransitioningRef.current) {
        socket.emit("user-busy", { to: data.fromId, callId: data.callId });
        return;
      }
      setActiveCall({ ...data, roomName: data.callId || data.roomName, fromId: data.fromId || data.callerData?.callerId });
      setIsIncomingCall(true);
      setCallStatus('ringing');
      socket.emit("confirm-ringing", { to: data.fromId });
    };

    const onRemoteEnd = (data) => {
      const currentId = activeCallRef.current?.roomName || activeCallRef.current?.callId;
      if (data?.callId && currentId && String(data.callId) !== String(currentId)) return;
      handleEndCall();
    };

    socket.on("incoming-call", onIncoming);
    socket.on("answer-call", (d) => { if (d.lkToken) { setPeerConnected(true); setLiveKitToken(d.lkToken); setCallStatus('connected'); } });
    socket.on("end-call", onRemoteEnd);
    socket.on("call-ended", onRemoteEnd);
    socket.on("call-rejected", onRemoteEnd);

    return () => {
      socket.off("incoming-call", onIncoming);
      socket.off("answer-call");
      socket.off("end-call", onRemoteEnd);
      socket.off("call-ended", onRemoteEnd);
      socket.off("call-rejected", onRemoteEnd);
    };
  }, [socket, agentData, isEnding, handleEndCall]);

  // Agent Profile Validation Pipeline Sync
  useEffect(() => {
    const token = localStorage.getItem('agentToken');
    if (!token) return navigate('/');

    const fetchAgentSession = async () => {
      try {
        const response = await fetch('/api/agents/my-session', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (response.ok) setAgentData(data.agent);
      } catch { console.warn("Agent session sync failed"); }
      finally { setLoading(false); }
    };
    fetchAgentSession();
  }, [navigate]);

  // Real-time AI Voice conversion Pipeline
  useEffect(() => {
    if (!socket) return;
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    const audioCtx = audioCtxRef.current;

    const handleAiAudioChunk = async (base64Audio) => {
      if (callStatus !== 'connected' || activeCall?.voiceId === 'natural' || !activeCall?.voiceId) return;
      try {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const binaryString = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = isSpeakerOn ? 1.0 : 0.7;
        gainNode.connect(audioCtx.destination);

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);

        if (nextStartTimeRef.current < audioCtx.currentTime) nextStartTimeRef.current = audioCtx.currentTime;
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
      } catch (err) { console.error("Agent AI voice matrix error:", err); }
    };

    socket.on("ai-audio-chunk", handleAiAudioChunk);
    return () => socket.off("ai-audio-chunk", handleAiAudioChunk);
  }, [socket, callStatus, isSpeakerOn, activeCall]);

  // Chronometer Setup
  useEffect(() => {
    let timer;
    if (callStatus === 'connected') {
      const localStart = Date.now();
      timer = setInterval(() => setCallTime(Math.max(0, Math.floor((Date.now() - localStart) / 1000))), 1000);
    } else { setCallTime(0); }
    return () => { if (timer) clearInterval(timer); };
  }, [callStatus]);

  // Sound Asset Loop Handler
  useEffect(() => {
    ringtoneAudio.current.loop = true; callingAudio.current.loop = true;
    if (callStatus === 'ringing' && isIncomingCall) { callingAudio.current.pause(); ringtoneAudio.current.play().catch(() => {}); }
    else if (callStatus === 'calling' || (callStatus === 'ringing' && !isIncomingCall)) { ringtoneAudio.current.pause(); callingAudio.current.play().catch(() => {}); }
    else { ringtoneAudio.current.pause(); callingAudio.current.pause(); }
  }, [callStatus, isIncomingCall]);

  return {
    callStatus, setCallStatus, activeCall, setActiveCall, activeCaller, isIncomingCall, peerConnected, liveKitToken,
    isMuted, setIsMuted, isSpeakerOn, setIsSpeakerOn, callTime, messages, setMessages, loading, agentData,
    handleAcceptCall, handleEndCall, handleRejectCall, terminateLocalSession
  };
}