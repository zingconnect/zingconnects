import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useUserZingCall(socket, userData, agent, messagesEndRef) {
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
  const [messages, setMessages] = useState([]);
  const [showFullScreenCall, setShowFullScreenCall] = useState(false);

  // Structural Synchronization References
  const callStatusRef = useRef('idle');
  const activeCallRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const pollingRef = useRef(null);
  const audioCtxRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const peerConnectedRef = useRef(false);
  const connectionTimeoutRef = useRef(null);
  const aiMediaRecorderRef = useRef(null);

  // Sound Assets
  const ringtoneAudio = useRef(new Audio('/sounds/ringtone.mp3'));
  const callingAudio = useRef(new Audio('/sounds/calling.wav'));
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));

  // Sync state variables to references for asynchronous callback closures
  useEffect(() => { if (callStatusRef) callStatusRef.current = callStatus; }, [callStatus]);
  useEffect(() => { if (activeCallRef) activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { if (peerConnectedRef) peerConnectedRef.current = peerConnected; }, [peerConnected]);

  // Secure Audio Subsystem Awake Handle
  const unlockAudio = useCallback(() => {
    if (hasInteracted) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const tempCtx = new AudioContext();
      if (tempCtx.state === 'suspended') tempCtx.resume();
    }
    const silentPlayer = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
    silentPlayer.play()
      .then(() => { 
        silentPlayer.pause(); 
        setHasInteracted(true); 
      })
      .catch(() => {});

    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) { 
      remoteAudio.play().then(() => remoteAudio.pause()).catch(() => {}); 
    }
  }, [hasInteracted]);

  // Audio Interaction Listeners
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

  const terminateLocalSession = useCallback(() => {
    setIsEnding(true);
    if (pollingRef && pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (connectionTimeoutRef && connectionTimeoutRef.current) { clearTimeout(connectionTimeoutRef.current); connectionTimeoutRef.current = null; }
    
    if (aiMediaRecorderRef && aiMediaRecorderRef.current) {
      try {
        if (aiMediaRecorderRef.current.state !== 'inactive') {
          aiMediaRecorderRef.current.stop();
        }
        aiMediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.warn("Media recorder cleanup jitter:", e);
      }
      aiMediaRecorderRef.current = null;
    }

    [ringtoneAudio, callingAudio].forEach(ref => { 
      if (ref && ref.current) { ref.current.pause(); ref.current.currentTime = 0; } 
    });
    if (audioCtxRef && audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (nextStartTimeRef) nextStartTimeRef.current = 0;

    setLiveKitToken(null);
    setCallStatus('idle');
    setIsIncomingCall(false);
    setActiveCall(null);
    setActiveCaller(null);
    setCallTime(0);
    setPeerConnected(false);
    setShowFullScreenCall(false);
    setTimeout(() => setIsEnding(false), 2000);
  }, []);

  // Structural Hangup Method
  const handleEndCall = useCallback(async () => {
    console.log("📴 Initiating Call End Sequence...");
    const myId = userData?._id || userData?.id;
    const currentCall = activeCallRef ? activeCallRef.current : null;
    const currentCallId = currentCall?.callId || currentCall?._id || currentCall?.roomName;
    const token = localStorage.getItem('userToken');
    const targetId = currentCall?.fromId === myId ? currentCall?.toId : currentCall?.fromId;

    try {
      if (currentCallId && token) {
        await fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        console.log("✅ Server notified: Call marked as inactive.");
      }
      if (socket && targetId) {
        socket.emit("end-call", { to: targetId.toString().trim(), callId: currentCallId });
        socket.off("ai-audio-chunk");
      }
    } catch (err) { 
      console.warn("⚠️ Error during end-call handshake:", err); 
    } finally { 
      terminateLocalSession(); 
    }
  }, [socket, userData, terminateLocalSession]);

  // Safety Status Poller
  const startStatusPolling = useCallback((roomName) => {
    const token = localStorage.getItem('userToken');
    const startTime = Date.now();
    if (pollingRef && pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      const currentStatus = callStatusRef ? callStatusRef.current : 'idle';
      if (currentStatus === 'idle' || isEnding) return;
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${roomName}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 404) {
          if (Date.now() - startTime > 8000) handleEndCall();
          return;
        }
        const data = await res.json();
        const terminalStates = ['ended', 'rejected', 'missed', 'declined'];

        if (terminalStates.includes(data.status) || data.active === false) {
          if (Date.now() - startTime > 5000) handleEndCall();
        }
      } catch (err) {
        console.warn("Status sync jitter:", err.message);
      }
    }, 4000);
  }, [isEnding, handleEndCall]);

  // Structural Outbound Call Method
  const handleStartCall = async () => {
    const currentUserId = userData?._id || userData?.id;
    const currentAgentId = agent?._id || agent?.id;
    const token = localStorage.getItem('userToken');
    const API_BASE_URL = import.meta.env.VITE_API_URL || "https://zingconnect.vercel.app";
  
    if (!currentAgentId || !currentUserId) {
      alert("Profile data still loading. Please try again.");
      return;
    }
  
    setCallStatus('calling'); 
  
    try {
      const res = await fetch(`${API_BASE_URL}/api/calls/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ 
          receiverId: currentAgentId, 
          receiverModel: 'Agent',
          voiceId: "natural" 
        })
      });
  
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Agent unavailable");
  
      const photoPath = userData?.photoUrl;
      const fullPhotoUrl = photoPath?.startsWith('http') 
        ? photoPath 
        : `${API_BASE_URL}/${photoPath?.replace(/^\//, '') || 'default-avatar.png'}`;
  
      setActiveCall({ 
        callId: data.roomName, 
        roomName: data.roomName,
        toId: currentAgentId.toString(),
        fromId: currentUserId,
        isInitiator: true,
        callerData: {
          fromName: `${userData?.firstName} ${userData?.lastName}`,
          photoUrl: fullPhotoUrl,
          callerId: currentUserId
        }
      });

      socket.emit("call-agent", { 
        agentToCall: currentAgentId.toString(),
        fromId: currentUserId,
        fromName: `${userData?.firstName} ${userData?.lastName}`,
        photoUrl: fullPhotoUrl,
        callId: data.roomName
      });

      setCallStatus('ringing'); 

      setTimeout(() => {
        if (data.lkToken) setLiveKitToken(data.lkToken); 
      }, 500);
  
      startStatusPolling(data.roomName);
  
    } catch (err) {
      console.error("❌ ZingConnect: Call initialization failed:", err);
      terminateLocalSession();
    }
  };

  // Structural Reject Method
  const handleRejectCall = useCallback(async () => {
    const currentCall = activeCallRef ? activeCallRef.current : null;
    if (!currentCall) { terminateLocalSession(); return; }

    const callId = currentCall.callId || currentCall._id || currentCall.roomName;
    const myId = userData?._id?.toString();
    const targetId = currentCall.fromId?.toString();

    if (socket && targetId && callId) {
      socket.emit("reject-call", { to: targetId, fromId: myId, callId: String(callId).trim() });
    }
    handleEndCall();
  }, [socket, userData, handleEndCall, terminateLocalSession]);

  // User Accepts Inbound Call Pipeline
  const handleAcceptCall = useCallback(async () => {
    const token = localStorage.getItem('userToken');
    const currentCall = activeCallRef ? activeCallRef.current : null;
    const callId = currentCall?.callId || currentCall?._id || currentCall?.roomName;
    if (!callId) return;

    try {
      if (isTransitioningRef) isTransitioningRef.current = true;
      setCallStatus('connecting');

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (data.success && data.lkToken) {
        const agentId = currentCall?.fromId?.toString();
        if (socket && agentId) {
          socket.emit("answer-call", { to: agentId, callId: data.roomName || callId, myId: userData?._id?.toString() });
        }
        setPeerConnected(true);
        setLiveKitToken(data.lkToken);
        if (isTransitioningRef) isTransitioningRef.current = false;
        setIsIncomingCall(false);
        setCallStatus('connected');
      } else { 
        throw new Error(); 
      }
    } catch {
      if (isTransitioningRef) isTransitioningRef.current = false;
      handleEndCall();
    }
  }, [userData, socket, handleEndCall]);

  // Time Formatter
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Media Stream Setup & Asset Injection
  useEffect(() => {
    let remoteAudio = document.getElementById('remoteAudio');
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'remoteAudio';
      remoteAudio.setAttribute('playsinline', 'true');
      remoteAudio.style.display = 'none';
      document.body.appendChild(remoteAudio);
    }
  
    const assets = [
      { ref: ringtoneAudio, src: '/sounds/ringtone.mp3' },
      { ref: callingAudio, src: '/sounds/calling.wav' },
      { ref: notificationSound, src: '/sounds/notification.mp3' }
    ];
  
    assets.forEach(({ ref, src }) => {
      const el = ref ? ref.current : null;
      if (el) {
        el.muted = true;
        el.src = src;
        el.load();
        el.play().then(() => {
          el.pause();
          el.muted = false;
          el.currentTime = 0;
        }).catch(() => console.log("Asset priming deferred"));
      }
    });
  
    if (socket && userData?._id) {
      socket.emit("join-private-room", userData._id);
    }
  }, [userData?._id, socket]);

  // Socket Core Signaling Layer Engine
  useEffect(() => {
    if (!socket || !userData?._id) return;
  
    const myId = userData._id.toString();
    socket.emit("join-main-room", myId);
  
    const onIncoming = async (data) => {
      if (peerConnectedRef) peerConnectedRef.current = false;
      setPeerConnected(false);

      const currentStatus = callStatusRef ? callStatusRef.current : 'idle';
      const currentTransition = isTransitioningRef ? isTransitioningRef.current : false;

      if (currentStatus !== 'idle' || isEnding || currentTransition) {
        console.log("☎️ Line busy or transitioning, rejecting incoming call from:", data.fromId);
        socket.emit("user-busy", { to: data.fromId, callId: data.callId });
        return;
      }
  
      console.log("📥 Incoming Secure Call detected:", data.callId);
      const roomName = data.callId || data.roomName;

      // Clean up past reference timeouts before binding a new tracking window
      if (connectionTimeoutRef && connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }

      if (connectionTimeoutRef) {
        connectionTimeoutRef.current = setTimeout(() => {
          const freshStatus = callStatusRef ? callStatusRef.current : 'idle';
          if (freshStatus === 'ringing') {
            console.log("⏰ Call timed out: No answer after 45s.");
            handleEndCall();
          }
        }, 45000);
      }

      setActiveCall({
        callId: data.callId || data._id,
        roomName: roomName,
        fromId: data.fromId || data.callerData?.callerId || data.from?._id,
        isInitiator: false,          
        voiceId: data.voiceId, 
        callerData: {
          fromName: data.fromName || data.callerData?.fromName || "Secure Agent",
          photoUrl: data.photoUrl || data.callerData?.photoUrl || "/default-agent.png",
          callerId: data.fromId
        }
      });
      
      setIsIncomingCall(true);
      setCallStatus('ringing');
      socket.emit("confirm-ringing", { to: data.fromId || data.callerData?.callerId });
    };
  
    const onRemoteEnd = (data) => {
      const currentCall = activeCallRef ? activeCallRef.current : null;
      const currentId = currentCall?.roomName || currentCall?.callId || currentCall?._id;
      const incomingId = data?.callId || data?.roomName || data?._id;
  
      if (incomingId && currentId && String(incomingId) !== String(currentId)) {
        console.warn("⏭️ Ignoring end-signal: ID mismatch", { incoming: incomingId, current: currentId });
        return;
      }
  
      console.log("📞 Remote peer disconnected. Shutting down locally.");
      handleEndCall();
    };

    const onAnswerReceived = (d) => {
      console.log("📡 Outbound Call Accepted by Agent:", d);
      if (d.lkToken) {
        if (peerConnectedRef) peerConnectedRef.current = true;
        setPeerConnected(true);
        setLiveKitToken(d.lkToken);
        setCallStatus('connected');
      }
    };
  
    socket.on("incoming-call", onIncoming);
    socket.on("call-ended", onRemoteEnd);
    socket.on("end-call", onRemoteEnd);
    socket.on("call-rejected", onRemoteEnd);
    socket.on("answer-call", onAnswerReceived);
  
    return () => {
      if (connectionTimeoutRef && connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      socket.off("incoming-call", onIncoming);
      socket.off("call-ended", onRemoteEnd);
      socket.off("end-call", onRemoteEnd);
      socket.off("call-rejected", onRemoteEnd);
      socket.off("answer-call", onAnswerReceived);
    };
  }, [socket, userData?._id, handleEndCall, isEnding]);

  // Real-time Audio Hardware Routing Controller
  useEffect(() => {
    const audio = document.getElementById('remoteAudio');
    if (!audio) return;
    const isUsingAI = activeCall?.voiceId && activeCall.voiceId !== "natural";
  
    if (isUsingAI) {
      audio.muted = true;
      audio.volume = 0;
    } else {
      audio.muted = false;
      audio.volume = isSpeakerOn ? 1.0 : 0.4;
    }
  }, [isSpeakerOn, activeCall?.voiceId, callStatus]);

  // Fallback Poller for API Incoming Checks
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    const currentTransition = isTransitioningRef ? isTransitioningRef.current : false;
    if (!token) return;
    if (callStatus !== 'idle' || isEnding || currentTransition) return;

    const checkCalls = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/check-incoming`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
        });
        if (!response.ok) return;
        const data = await response.json();

        if (data && data.hasIncomingCall) {
          const freshStatus = callStatusRef ? callStatusRef.current : 'idle';
          const freshTransition = isTransitioningRef ? isTransitioningRef.current : false;
          if (freshStatus !== 'idle' || isEnding || freshTransition) return;

          setActiveCall({
            callId: data.callId,
            fromId: data.callerData?.callerId || data.fromId,
            roomName: data.roomName || data.callId,
            callerData: data.callerData,
            voiceId: data.voiceId,
            from: {
              firstName: data.callerData?.fromName?.split(' ')[0] || "Incoming",
              lastName: data.callerData?.fromName?.split(' ')[1] || "Call",
              photoUrl: data.callerData?.photoUrl
            }
          });
          
          setIsIncomingCall(true); 
          setCallStatus('ringing');
        }
      } catch (err) {
        console.warn("User Polling error:", err);
      }
    };

    const interval = setInterval(checkCalls, 4000); 
    return () => clearInterval(interval);
  }, [isEnding, callStatus]);

  // Real-time Audio Streaming (AI Voice Conversion Engine Matrix)
  useEffect(() => {
    if (!socket) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const audioCtx = audioCtxRef.current;

    const handleAiAudioChunk = async (base64Audio) => {
      const currentCall = activeCallRef ? activeCallRef.current : null;
      const isNaturalMode = currentCall?.voiceId === 'natural' || !currentCall?.voiceId;
      if (callStatus !== 'connected' || isNaturalMode) return;

      try {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const binaryString = window.atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = isSpeakerOn ? 1.0 : 0.7;
        gainNode.connect(audioCtx.destination);

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode);

        if (nextStartTimeRef && nextStartTimeRef.current < audioCtx.currentTime) {
          nextStartTimeRef.current = audioCtx.currentTime;
        }
        source.start(nextStartTimeRef.current);
        if (nextStartTimeRef) nextStartTimeRef.current += audioBuffer.duration;
      } catch (err) { 
        console.error("User AI voice matrix error:", err); 
      }
    };

    socket.on("ai-audio-chunk", handleAiAudioChunk);
    return () => socket.off("ai-audio-chunk", handleAiAudioChunk);
  }, [socket, callStatus, isSpeakerOn]);

  // Chronometer Setup
  useEffect(() => {
    let timer;
    if (callStatus === 'connected') {
      const localStart = Date.now();
      timer = setInterval(() => setCallTime(Math.max(0, Math.floor((Date.now() - localStart) / 1000))), 1000);
      console.log("⏱️ Call timer started.");
    } else { 
      setCallTime(0); 
    }
    return () => { if (timer) clearInterval(timer); };
  }, [callStatus]);

  useEffect(() => {
    if (!socket) return;
    const handleNewMessage = (msg) => {
      setMessages(prev => {
        if (prev.some(m => m._id === msg._id || m.tempId === msg._id)) return prev;
        if (msg.senderModel === 'Agent' && notificationSound && notificationSound.current) { 
          notificationSound.current.play().catch(() => {}); 
        }
        return [...prev, msg];
      });
      setTimeout(() => {
        if (messagesEndRef && typeof messagesEndRef.current !== 'undefined' && messagesEndRef.current !== null) {
          try {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
          } catch (scrollError) {
            console.warn("📡 ZingConnect Sync Jitter: Handled scrolling offset drop gracefully.");
          }
        }
      }, 100);
    };
    const handleMessageDeleted = (id) => setMessages(prev => prev.filter(m => (m._id || m.id) !== id));
    socket.on("new-message", handleNewMessage);
    socket.on("message-deleted", handleMessageDeleted);
    return () => { 
      socket.off("new-message", handleNewMessage); 
      socket.off("message-deleted", handleMessageDeleted); 
    };
  }, [socket, messagesEndRef]);

  useEffect(() => {
    if (ringtoneAudio && ringtoneAudio.current) ringtoneAudio.current.loop = true; 
    if (callingAudio && callingAudio.current) callingAudio.current.loop = true;
    
    const rAudio = ringtoneAudio ? ringtoneAudio.current : null;
    const cAudio = callingAudio ? callingAudio.current : null;

    if (callStatus === 'ringing' && isIncomingCall) { 
      if (cAudio) cAudio.pause(); 
      if (rAudio) rAudio.play().catch(() => {}); 
    } else if (callStatus === 'calling' || (callStatus === 'ringing' && !isIncomingCall)) { 
      if (rAudio) rAudio.pause(); 
      if (cAudio) cAudio.play().catch(() => {}); 
    } else { 
      if (rAudio) rAudio.pause(); 
      if (cAudio) cAudio.pause(); 
    }
  }, [callStatus, isIncomingCall]);

  return {
    callStatus, setCallStatus, activeCall, setActiveCall, activeCaller, isIncomingCall, peerConnected, liveKitToken,
    isMuted, setIsMuted, isSpeakerOn, setIsSpeakerOn, callTime, messages, setMessages, hasInteracted, unlockAudio,
    handleStartCall, handleAcceptCall, handleEndCall, handleRejectCall, formatTime, showFullScreenCall, setShowFullScreenCall
  };
}