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

  // Structural Synchronization References
  const callStatusRef = useRef('idle');
  const activeCallRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const pollingRef = useRef(null);
  const audioCtxRef = useRef(null);
  const nextStartTimeRef = useRef(0);
  const peerConnectedRef = useRef(false);

  // Sound Assets
  const ringtoneAudio = useRef(new Audio('/sounds/ringtone.mp3'));
  const callingAudio = useRef(new Audio('/sounds/calling.wav'));
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));

  // Sync state variables to references for asynchronous callback closures
  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { peerConnectedRef.current = peerConnected; }, [peerConnected]);

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
  if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  
  [ringtoneAudio, callingAudio].forEach(ref => { 
    if (ref?.current) { ref.current.pause(); ref.current.currentTime = 0; } 
  });
  if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
    audioCtxRef.current.close().catch(() => {});
    audioCtxRef.current = null;
  }
  nextStartTimeRef.current = 0;

  setLiveKitToken(null);
  setCallStatus('idle');
  setIsIncomingCall(false);
  setActiveCall(null);
  setActiveCaller(null);
  setCallTime(0);
  setPeerConnected(false);
  setTimeout(() => setIsEnding(false), 2000);
}, []);

  // Safety Status Poller
  const startStatusPolling = useCallback((roomName) => {
    const token = localStorage.getItem('userToken');
    const startTime = Date.now();
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      if (callStatusRef.current === 'idle' || isEnding) return;
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${roomName}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 404) {
          if (Date.now() - startTime > 8000) {
            handleEndCall();
          }
          return;
        }
        const data = await res.json();
        const terminalStates = ['ended', 'rejected', 'missed', 'declined'];

        if (terminalStates.includes(data.status) || data.active === false) {
          if (Date.now() - startTime > 5000) {
            handleEndCall();
          }
        }
      } catch (err) {
        console.warn("Status sync jitter:", err.message);
      }
    }, 4000);
  }, [isEnding]);

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
        if (data.lkToken) {
          setLiveKitToken(data.lkToken); 
        }
      }, 500);
  
      startStatusPolling(data.roomName);
  
    } catch (err) {
      console.error("❌ ZingConnect: Call initialization failed:", err);
      terminateLocalSession();
    }
  };

  // Structural Hangup Method
  const handleEndCall = useCallback(async () => {
    const myId = userData?._id || userData?.id;
    const currentCallId = activeCallRef.current?.callId || activeCallRef.current?._id || activeCallRef.current?.roomName;
    const token = localStorage.getItem('userToken');
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
    } catch { 
      console.warn("Teardown handling network error"); 
    } finally { 
      terminateLocalSession(); 
    }
  }, [socket, userData, terminateLocalSession]);

  // Structural Reject Method
  const handleRejectCall = useCallback(async () => {
    const currentCall = activeCallRef.current;
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
    const callId = activeCallRef.current?.callId || activeCallRef.current?._id || activeCallRef.current?.roomName;
    if (!callId) return;

    try {
      isTransitioningRef.current = true;
      setCallStatus('connecting');

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (data.success && data.lkToken) {
        const agentId = activeCallRef.current?.fromId?.toString();
        if (socket && agentId) {
          socket.emit("answer-call", { to: agentId, callId: data.roomName || callId, myId: userData?._id?.toString() });
        }
        setPeerConnected(true);
        setLiveKitToken(data.lkToken);
        isTransitioningRef.current = false;
        setIsIncomingCall(false);
      } else { 
        throw new Error(); 
      }
    } catch {
      isTransitioningRef.current = false;
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
      const el = ref.current;
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
      if (callStatusRef.current !== 'idle' || isEnding) {
        socket.emit("user-busy", { to: data.fromId, callId: data.callId });
        return;
      }
  
      const roomName = data.callId || data.roomName;
      setActiveCall({
        ...data,
        roomName: roomName,
        fromId: data.fromId || data.callerData?.callerId
      });
      setIsIncomingCall(true);
      setCallStatus('ringing');
      socket.emit("confirm-ringing", { to: data.fromId || data.callerData?.callerId });
    };
  
    const onRemoteEnd = (data) => {
      const currentId = activeCallRef.current?.roomName || activeCallRef.current?.callId || activeCallRef.current?._id;
      const incomingId = data?.callId || data?.roomName || data?._id;
  
      if (!currentId) {
        if (callStatusRef.current !== 'idle') handleEndCall();
        return;
      }
      if (incomingId && currentId && String(incomingId) !== String(currentId)) return;
  
      handleEndCall();
    };

    const onAnswerReceived = (d) => {
      if (d.lkToken) {
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

 useEffect(() => {
  const token = localStorage.getItem('userToken');
  if (!token) return;

  // Stop polling entirely if the user is engaged in a call state
  if (callStatus !== 'idle' || isEnding || isTransitioningRef.current) return;

  const checkCalls = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/check-incoming`, {
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Cache-Control': 'no-cache' 
        }
      });
      if (!response.ok) return;
      const data = await response.json();

      if (data && data.hasIncomingCall) {
        // Double check ref before state update to block race conditions
        if (callStatusRef.current !== 'idle' || isEnding || isTransitioningRef.current) return;

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

useEffect(() => {
  if (!socket) return;

  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  const audioCtx = audioCtxRef.current;

  const handleAiAudioChunk = async (base64Audio) => {
    const isNaturalMode = activeCall?.voiceId === 'natural' || !activeCall?.voiceId;
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

      const currentTime = audioCtx.currentTime;
      if (nextStartTimeRef.current < currentTime) {
        nextStartTimeRef.current = currentTime;
      }
      
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    } catch (err) {
      console.error("AI Audio Stream Error:", err);
    }
  };

  socket.on("ai-audio-chunk", handleAiAudioChunk);
  return () => socket.off("ai-audio-chunk", handleAiAudioChunk);
}, [socket, callStatus, isSpeakerOn, activeCall?.voiceId]);


useEffect(() => {
  if (!hasInteracted) {
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
  }
  return () => {
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  };
}, [hasInteracted, agent?._id]); // Re-bind if agent loads later

const handleEndCall = useCallback(async () => {
  console.log("📴 Initiating Call End Sequence...");
  
  // 1. Clear Timeouts and Pollers
  if (connectionTimeoutRef.current) {
    clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = null;
  }
  if (pollingRef.current) {
    console.log("🛑 Stopping background status polling...");
    clearInterval(pollingRef.current);
    pollingRef.current = null;
  }
  const myId = userData?._id || userData?.id;
  const currentCallId = activeCall?.callId || activeCall?._id || activeCall?.roomName;
  const token = localStorage.getItem('userToken');
  const targetId = activeCall?.fromId === myId 
    ? activeCall?.toId 
    : activeCall?.fromId;
  try {
    if (currentCallId && token) {
      await fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log("✅ Server notified: Call marked as inactive.");
    }
    if (socket && targetId) {
      socket.emit("end-call", { 
        to: targetId.toString().trim(), 
        callId: currentCallId 
      });
      socket.off("ai-audio-chunk");
    }
  } catch (err) {
    console.warn("⚠️ Error during end-call handshake:", err);
  } finally {
    terminateLocalSession();
  }
}, [socket, userData, activeCall, terminateLocalSession]);

useEffect(() => {
  if (!socket || !userData?._id) return;

  const myId = userData._id.toString();
  socket.emit("join-main-room", myId);

  const handleIncomingCall = (data) => {
    // 🔥 RESET GATES for the new call
    peerConnectedRef.current = false;
    setPeerConnected(false);

    if (callStatusRef.current !== 'idle' || isEnding || isTransitioningRef.current) {
      console.log("☎️ Line busy or transitioning, rejecting incoming call from:", data.fromId);
      socket.emit("user-busy", { to: data.fromId, callId: data.callId });
      return; 
    }

    console.log("📥 Incoming Secure Call detected:", data.callId);

    const ringTimeout = setTimeout(() => {
      if (callStatusRef.current === 'ringing') {
        console.log("⏰ Call timed out: No answer after 45s.");
        handleEndCall();
      }
    }, 45000);

    socket.emit("confirm-ringing", { to: data.fromId });

    setActiveCall({ 
      callId: data.callId || data._id,
      roomName: data.callId || data.roomName,
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
  };

  const handleCallAccepted = (acceptData) => {
    console.log("📡 Outbound Call Accepted by Agent:", acceptData);
    if (acceptData.lkToken) {
      // 🔥 Mark peer as ready so the LiveKitRoom bridge can activate immediately
      peerConnectedRef.current = true;
      setPeerConnected(true);
      setLiveKitToken(acceptData.lkToken);
      setCallStatus('connected');
    }
  };
  const handleRemoteEnd = (data) => {
    const currentCallId = (activeCallRef.current?.callId || activeCallRef.current?._id || "").toString();
    const incomingCallId = (data?.callId || data?.roomName || "").toString();

    if (incomingCallId && currentCallId && incomingCallId !== currentCallId) {
      console.warn("⏭️ Ignoring end-signal: ID mismatch", { incoming: incomingCallId, current: currentCallId });
      return;
    }

    console.log("📞 Remote peer disconnected. Shutting down locally.");
    handleEndCall();
  };

  socket.on("incoming-call", handleIncomingCall);
  socket.on("call-accepted", handleCallAccepted);
  socket.on("end-call", handleRemoteEnd);
  socket.on("call-ended", handleRemoteEnd);
  socket.on("call-rejected", handleRemoteEnd);

  return () => {
    socket.off("incoming-call", handleIncomingCall);
    socket.off("call-accepted", handleCallAccepted);
    socket.off("end-call", handleRemoteEnd);
    socket.off("call-ended", handleRemoteEnd);
    socket.off("call-rejected", handleRemoteEnd);
  };
}, [socket, userData?._id, handleEndCall, isEnding]);

useEffect(() => {
  if (!socket) return;

  const handleRemoteDisconnect = (data) => {
    const currentCallId = activeCall?.callId || activeCall?._id;
    const incomingSignalCallId = data?.callId;
    if (incomingSignalCallId && currentCallId && String(incomingSignalCallId) !== String(currentCallId)) {
      console.warn("⚠️ ZingConnect: Received end signal for a different session. Ignoring.");
      return;
    }
    console.log("📴 ZingConnect: Remote peer disconnected. Cleaning up...");
        if (aiMediaRecorderRef?.current) {
      try {
        if (aiMediaRecorderRef.current.state !== 'inactive') {
          aiMediaRecorderRef.current.stop();
        }
        aiMediaRecorderRef.current.stream?.getTracks().forEach(t => {
          t.stop();
          console.log("🚫 Media track stopped.");
        });
      } catch (e) { 
        console.warn("ZingConnect: Cleanup jitter", e); 
      }
      aiMediaRecorderRef.current = null;
    }
    [ringtoneAudio, callingAudio].forEach(ref => {
      if (ref?.current) {
        ref.current.pause();
        ref.current.currentTime = 0;
      }
    });
    setCallStatus('idle');
setLiveKitToken(null);
    setActiveCall(null);
    setActiveCaller(null);
    setPeerConnected(false);
    setShowFullScreenCall(false);
    setCallTime(0); 
    if (typeof setIsVoiceConversionActive === 'function') {
      setIsVoiceConversionActive(false);
    }
  };
  socket.on("call-ended", handleRemoteDisconnect);
  socket.on("end-call", handleRemoteDisconnect);
  socket.on("call-rejected", handleRemoteDisconnect);
  return () => {
    socket.off("call-ended", handleRemoteDisconnect);
    socket.off("end-call", handleRemoteDisconnect);
    socket.off("call-rejected", handleRemoteDisconnect);
  };
}, [
  socket, 
  activeCall?.callId, 
  activeCall?._id, 
]);


useEffect(() => {
  let timer;
  if (callStatus === 'connected') {
    setCallTime(0);
    const localStart = Date.now();
    timer = setInterval(() => {
      const now = Date.now();
      const secondsPassed = Math.floor((now - localStart) / 1000);
      setCallTime(Math.max(0, secondsPassed));
    }, 1000);
    console.log("⏱️ Call timer started.");
  } else if (callStatus === 'idle') {
    setCallTime(0);
  }

  return () => {
    if (timer) clearInterval(timer);
  };
}, [callStatus]);

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
      } catch (err) { 
        console.error("User AI voice matrix error:", err); 
      }
    };

    socket.on("ai-audio-chunk", handleAiAudioChunk);
    return () => socket.off("ai-audio-chunk", handleAiAudioChunk);
  }, [socket, callStatus, isSpeakerOn, activeCall]);

  // Text Message Listener Engine Synchronization Layer
  useEffect(() => {
    if (!socket) return;
    socket.on("new-message", (msg) => {
      setMessages(prev => {
        if (prev.some(m => m._id === msg._id || m.tempId === msg._id)) return prev;
        if (msg.senderModel === 'Agent' && notificationSound.current) { 
          notificationSound.current.play().catch(() => {}); 
        }
        return [...prev, msg];
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    socket.on("message-deleted", (id) => setMessages(prev => prev.filter(m => (m._id || m.id) !== id)));
    return () => { socket.off("new-message"); socket.off("message-deleted"); };
  }, [socket, messagesEndRef]);

  // Chronometer Setup
  useEffect(() => {
    let timer;
    if (callStatus === 'connected') {
      const localStart = Date.now();
      timer = setInterval(() => setCallTime(Math.max(0, Math.floor((Date.now() - localStart) / 1000))), 1000);
    } else { setCallTime(0); }
    return () => { if (timer) clearInterval(timer); };
  }, [callStatus]);

  // Sound Ringer Loop Control
  useEffect(() => {
    ringtoneAudio.current.loop = true; 
    callingAudio.current.loop = true;
    
    if (callStatus === 'ringing' && isIncomingCall) { 
      callingAudio.current.pause(); 
      ringtoneAudio.current.play().catch(() => {}); 
    } else if (callStatus === 'calling' || (callStatus === 'ringing' && !isIncomingCall)) { 
      ringtoneAudio.current.pause(); 
      callingAudio.current.play().catch(() => {}); 
    } else { 
      ringtoneAudio.current.pause(); 
      callingAudio.current.pause(); 
    }
  }, [callStatus, isIncomingCall]);

  return {
    callStatus, setCallStatus, activeCall, setActiveCall, activeCaller, isIncomingCall, peerConnected, liveKitToken,
    isMuted, setIsMuted, isSpeakerOn, setIsSpeakerOn, callTime, messages, setMessages, hasInteracted, unlockAudio,
    handleStartCall, handleAcceptCall, handleEndCall, handleRejectCall, formatTime
  };
}