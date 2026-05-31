import { 
  LiveKitRoom, AudioConference, useTracks,RoomAudioRenderer, StartAudio, useLocalParticipant
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.global = window;
  window.process = {
    env: { DEBUG: undefined },
    version: '',
    nextTick: (fn) => setTimeout(fn, 0),
    listeners: () => [],
    on: () => [],
    removeListener: () => [],
  };
}
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { motion, useAnimation } from "framer-motion";
import Peer from 'simple-peer';
import { useDrag } from "@use-gesture/react";
import ReactPhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import { 
  BsTelephoneFill, BsPlusLg, BsSendFill, BsCheckAll,BsChevronLeft,BsShieldLockFill,BsGearFill,
  BsArrowRight, BsCameraFill, BsMicFill, BsVolumeUpFill,BsMicMuteFill, BsPaperclip,BsDownload,
  BsPlayFill, BsXLg, BsX 
} from 'react-icons/bs';


function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
const socket = io(import.meta.env.VITE_API_URL);
const PhoneInput = ReactPhoneInput.default || ReactPhoneInput;

const CallStatusMessage = ({ status, time }) => {
  const isMissed = status === 'missed' || status === 'declined';
  const isRinging = status === 'ringing';

  return (
    <div className="flex justify-center my-4 w-full z-10">
      <div className="bg-[#1f2c33] rounded-xl px-4 py-3 flex items-center gap-3 min-w-[240px] border border-white/10 shadow-xl animate-in fade-in zoom-in duration-300">
        <div className={`${isMissed ? 'bg-red-500/20' : 'bg-slate-700'} p-2.5 rounded-full`}>
          <BsTelephoneFill 
            className={isMissed ? 'text-red-500' : 'text-green-500'} 
            size={16} 
          />
        </div>
        <div className="flex-1">
          <h4 className="text-white text-[13px] font-bold tracking-tight">Voice call</h4>
          <div className="text-gray-400 text-[11px] font-medium capitalize flex items-center gap-1.5">
            {isRinging ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span className="text-blue-400 font-bold uppercase text-[9px] tracking-widest">Ringing...</span>
              </>
            ) : (
              <span className={isMissed ? 'text-red-400 font-semibold' : 'text-gray-400'}>
                {status === 'ended' ? 'Call Ended' : status}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-gray-500 font-mono mt-auto ml-2">{time}</span>
      </div>
    </div>
  );
};

export const UserDashboard = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const messagesEndRef = useRef(null);
const ringtoneAudio = useRef(new Audio('/sounds/ringtone.mp3')); // Incoming
const callingAudio = useRef(new Audio('/sounds/calling.wav'));  // Outgoing (New)
const notificationSound = useRef(new Audio('/sounds/notification.mp3'));
  const serverUrl = import.meta.env.VITE_LIVEKIT_URL
const isFirstLoad = useRef(true);
  const connectionRef = useRef(null);
  const pollingRef = useRef(null);
  const connectionTimeoutRef = useRef(null);
  const userStreamRef = useRef(null); 
  const activeCallRef = useRef(null);
  const remoteStreamRef = useRef(null); 
  const lastNotifiedId = useRef(null);
  const callStatusRef = useRef('idle');
  const isTransitioningRef = useRef(false);
  const peerConnectedRef = useRef(false);
  const audioCtxRef = useRef(null);
const nextStartTimeRef = useRef(0);
const chatContainerRef = useRef(null);
  const [agent, setAgent] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('online');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [liveKitToken, setLiveKitToken] = useState(null);
  const [page, setPage] = useState(1);
const [hasMore, setHasMore] = useState(true);
const [loadingMore, setLoadingMore] = useState(false);
const scrollSentinelRef = useRef(null); 
const [isFetchingOlder, setIsFetchingOlder] = useState(false);
const isAdjustingScrollRef = useRef(false); 
const previousScrollHeightRef = useRef(0);
const previousScrollTopRef = useRef(0);

  const [callStatus, setCallStatus] = useState('idle'); 
  const [activeCall, setActiveCall] = useState(null); 
  const [activeCaller, setActiveCaller] = useState(null); 
  const [localStream, setLocalStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callTime, setCallTime] = useState(0);
  const [peerConnected, setPeerConnected] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  

  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingFile, setOnboardingFile] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [showFullScreenCall, setShowFullScreenCall] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const { agentId: slugFromUrl } = useParams();
  
  const API_BASE_URL = import.meta.env.VITE_API_URL

  const [formData, setFormData] = useState({
  firstName: '',
  lastName: '',
  phone: {
    raw: '',
    formatted: '',
    countryCode: 'us',
    dialCode: '1'
  },
  dob: '',
  gender: '',
  city: '',
  state: ''
});

    useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);


  const getStatusInfo = (agent) => {
    if (!agent) return { isOnline: false, label: "Connecting..." };
    if (agent.status === 'online') return { isOnline: true, label: "Online" };
    if (agent.lastSeenText) return { isOnline: false, label: agent.lastSeenText };
    if (agent.lastActive) {
      const diff = Math.floor((new Date() - new Date(agent.lastActive)) / 1000);
      if (diff < 120) return { isOnline: true, label: "Online" };
    }
    return { isOnline: false, label: "Offline" };
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'seen':
        return <BsCheckAll className="text-blue-500" size={18} />;
      case 'delivered':
        return <BsCheckAll className="text-gray-400" size={18} />;
      default:
        return <BsCheckAll className="text-gray-300" size={14} />;
    }
  };
  
const unlockAudio = useCallback(async () => {
  if (hasInteracted) return;
  console.log("🔓 Unlocking secure audio channels...");
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      await ctx.resume();
      console.log("✅ AudioContext resumed.");
    }
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio) {
      await remoteAudio.play();
      remoteAudio.pause();
      remoteAudio.currentTime = 0;
      console.log("✅ Remote audio element primed.");
    }
    setHasInteracted(true);
  } catch (err) {
    console.warn("⚠️ Audio priming error:", err);
    setHasInteracted(true); 
  }
}, [hasInteracted]);

const LocalUserMuteController = ({ isMuted, isMasked }) => {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    if (!localParticipant) return;
    const syncMic = async () => {
      const shouldPublish = !isMasked && !isMuted;
      try {
        await localParticipant.setMicrophoneEnabled(shouldPublish);
        console.log(`🎤 ZingConnect Mic Sync: ${shouldPublish ? 'PUBLISHING' : 'MUTED/MASKED'}`);
      } catch (err) {
        console.error("❌ LiveKit Mic Sync Error:", err);
      }
    };

    syncMic();
  }, [isMuted, isMasked, localParticipant]);

  return null;
};

const AudioSession = ({ isMuted, isMasked }) => {
  return (
    <>
      <LocalUserMuteController isMuted={isMuted} isMasked={isMasked} />
      <RoomAudioRenderer />
    </>
  );
};

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

useEffect(() => {
  let remoteAudio = document.getElementById('remoteAudio');
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio');
    remoteAudio.id = 'remoteAudio';
    remoteAudio.setAttribute('playsinline', 'true');
    remoteAudio.style.display = 'none';
    document.body.appendChild(remoteAudio);
  }

  // 2. Prime UI Assets
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
      }).catch(e => console.log("Asset priming deferred"));
    }
  });

  // 3. Socket Room Join
  if (socket && agent?._id) {
    socket.emit("join-private-room", agent._id);
  }
}, [agent?._id]); // Runs when agent data loads

const terminateLocalSession = useCallback(() => {
  console.log("🧹 Executing Full Local Cleanup...");
    setIsEnding(true);
  
  [ringtoneAudio, callingAudio].forEach(ref => {
    if (ref?.current) {
      ref.current.pause();
      ref.current.currentTime = 0;
    }
  });

  setLiveKitToken(null);
  setCallStatus('idle');
  setIsIncomingCall(false);
  setActiveCall(null);
  setCallTime(0);
  setShowFullScreenCall(false);
  setPeerConnected(false);

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    setLocalStream(null);
  }
  setTimeout(() => {
    setIsEnding(false);
  }, 3000);
}, [localStream, ringtoneAudio, callingAudio]);

useEffect(() => {
  activeCallRef.current = activeCall;
}, [activeCall]);

useEffect(() => {
  socket.on("voice-state-updated", (data) => {
    if (data.mode === 'natural') {
      const remoteAudio = document.getElementById('remoteAudio');
      if (remoteAudio) {
        remoteAudio.muted = false; // Force unmute the WebRTC stream
        remoteAudio.volume = isSpeakerOn ? 1.0 : 0.7;
        console.log("🔊 Switch to Natural: WebRTC Unmuted");
      }
    }
  });
  return () => socket.off("voice-state-updated");
}, [socket, isSpeakerOn]);

useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('Service Worker Registered:', reg.scope);
        reg.onupdatefound = () => {
          const installingWorker = reg.installing;
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('New content is available; please refresh.');
            }
          };
        };
      })
      .catch(err => console.error('SW Registration failed:', err));
  }
}, []);

const triggerCamera = () => {
  if (cameraInputRef.current) {
    cameraInputRef.current.value = ''; 
    cameraInputRef.current.click();
  }
};

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
const handleEndCall = useCallback(async () => {
  console.log("📴 Initiating Call End Sequence...");
  
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
  const targetId = activeCall?.fromId === myId 
    ? activeCall?.toId 
    : activeCall?.fromId;

  try {
    if (currentCallId) {
      // 🛡️ SECURITY FIX: Use credentials: 'include' for cookie-based auth
      await fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
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
    setLkToken(null);           // Disconnects LiveKit
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
  return () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };
}, [previewUrl]);

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};
useEffect(() => {
  const currentCallId = activeCall?.callId || activeCall?._id;
  
  if (!currentCallId || callStatus === 'idle' || callStatus === 'connected' || isEnding) return;
  
  const syncSessionStart = Date.now();
  
  const syncStatus = async () => {
    if (isEnding || callStatus === 'connected') return;
    
    try {
      // 🛡️ SECURITY FIX: Use credentials: 'include' for cookie-based auth
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${currentCallId}`, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        credentials: 'include'
      });
      
      if (res.status === 404) {
        if (Date.now() - syncSessionStart > 15000) {
          console.log("⚠️ Call record missing after long grace period.");
          handleEndCall();
        }
        return;
      }
      const data = await res.json();
      if (!data) return;
      const terminalStates = ['ended', 'declined', 'missed', 'rejected'];
      if (terminalStates.includes(data.status) || data.active === false) {
        const timeElapsed = Date.now() - syncSessionStart;
        if (timeElapsed < 30000 && callStatus === 'ringing') {
          return;
        }
        console.log("🔴 DB Sync: Server confirmed call is truly over.");
        handleEndCall();
        return;
      }
      
      if (data.status === 'connected' && callStatus === 'ringing') {
        console.log("📡 DB Sync: Agent connected.");
        setCallStatus('connected');
      }
    } catch (e) {
      console.warn("Sync Polling jitter:", e);
    }
  };
  
  const interval = setInterval(syncStatus, 5000); 
  return () => clearInterval(interval);
}, [callStatus, activeCall?.callId, activeCall?._id, isEnding]);

useEffect(() => {
  if (!socket) return;
  const handleRemoteEnd = (data) => {
    const currentCallId = (activeCall?.callId || activeCall?._id || "").toString();
    const incomingCallId = (data?.callId || "").toString();
    console.log("📡 Signal Received:", data);
    if (incomingCallId && currentCallId && incomingCallId !== currentCallId) {
      console.warn("Ignored signal: ID mismatch", { 
        received: incomingCallId, 
        current: currentCallId 
      });
      return;
    }
    console.log("☎️ Remote cleanup triggered (End/Reject). Resetting UI...");
    handleEndCall(); 
  };
  socket.on("call-ended", handleRemoteEnd);
  socket.on("end-call", handleRemoteEnd);
  socket.on("call-rejected", handleRemoteEnd);

  return () => {
    socket.off("call-ended", handleRemoteEnd);
    socket.off("end-call", handleRemoteEnd);
    socket.off("call-rejected", handleRemoteEnd);
  };
  }, [socket, activeCall?.callId, activeCall?._id]);

useEffect(() => {
  const audio = document.getElementById('remoteAudio');
  if (!audio) return;
  const isUsingAI = activeCall?.voiceId && activeCall.voiceId !== "natural";

  if (isUsingAI) {
    audio.muted = true;
    audio.volume = 0;
  } else {
    audio.muted = false;
    audio.volume = isSpeakerOn ? 1.0 : 0.2;
        if (audio.setSinkId && isSpeakerOn) {
      audio.setSinkId('').catch(err => console.warn("Audio route error:", err));
    }
  }
}, [isSpeakerOn, activeCall?.voiceId, callStatus]);

const checkCalls = async () => {
  if (
    callStatusRef.current !== 'idle' || 
    isEnding || 
    isTransitioningRef.current
  ) {
    return; 
  }

  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/check-incoming`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
      credentials: 'include'
    });
    if (response.status === 401 || response.status === 403) {
      console.warn("Session expired. Redirecting to agent entry...");
      window.location.href = `/${slugFromUrl}`; 
      return;
    }

    if (!response.ok) return;

    const data = await response.json();

    if (data && data.hasIncomingCall) {
      if (callStatusRef.current !== 'idle' || isEnding || isTransitioningRef.current) return;

      console.log("📡 Poller found incoming call, triggering UI...");
      setActiveCall({
        callId: data.callId,
        fromId: data.callerData?.callerId || data.fromId,
        roomName: data.roomName || data.callId,
        callerData: data.callerData,
        voiceId: data.voiceId
      });
      
      setIsIncomingCall(true); 
      setCallStatus('ringing');
    }
  } catch (err) {
    console.warn("User Polling error:", err);
  }
};

useEffect(() => {
  // 1. Set looping once
  ringtoneAudio.current.loop = true;
  callingAudio.current.loop = true;
  const handleAudioLogic = async () => {
    try {
      // Incoming Call Logic
      if (callStatus === 'ringing' && isIncomingCall) {
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
                await ringtoneAudio.current.play();
        console.log("🔊 Playing Ringtone");
      } 
      // Outgoing Call Logic
      else if (callStatus === 'calling' || (callStatus === 'ringing' && !isIncomingCall)) {
        ringtoneAudio.current.pause();
        ringtoneAudio.current.currentTime = 0;
        await callingAudio.current.play();
        console.log("🔉 Playing Outgoing Call Sound");
      } 
      // Stop/Idle Logic
      else {
        ringtoneAudio.current.pause();
        ringtoneAudio.current.currentTime = 0;
        
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
      }
    } catch (err) {
      console.warn("Audio playback prevented. User must interact with the document first.", err);
    }
  };
  handleAudioLogic();
  return () => {
    ringtoneAudio.current.pause();
    callingAudio.current.pause();
  };
}, [callStatus, isIncomingCall]);


useEffect(() => {
  const remoteMedia = document.getElementById('remoteAudio'); 
  
  if (remoteMedia && callStatus === 'connected') {
    remoteMedia.volume = isSpeakerOn ? 1.0 : 0.4; 
    remoteMedia.muted = false;
        if (remoteMedia.paused) {
      remoteMedia.play().catch(e => console.log("Playback pending gesture"));
    }
  }
}, [isSpeakerOn, callStatus]);
const toggleMute = () => {
  setIsMuted(prev => {
    const newState = !prev;
  const stream = localStream || userStreamRef.current;  
    if (stream) {
      stream.getAudioTracks().forEach(track => {
        track.enabled = !newState; // Track enabled = not muted
      });
      console.log(`Mic ${newState ? 'disabled' : 'enabled'}`);
    } else {
      console.warn("No active stream found to mute");
    }
    return newState;
  });
};
const handleAcceptCall = async () => {
  // 1. Audio Pipeline Wake-up
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(e => console.warn("Context unlock blocked:", e));
    }
  }

  // 2. Kill Local Ringtone
  if (ringtoneAudio.current) {
    ringtoneAudio.current.pause();
    ringtoneAudio.current.currentTime = 0;
  }

  const callId = activeCall?.callId || activeCall?._id || activeCall?.roomName;

  if (!callId) {
    console.error("No valid Call ID found for acceptance.");
    return;
  }
  
  try {
    setIsEnding(false); 
    isTransitioningRef.current = true;
    setCallStatus('connecting');
    setShowFullScreenCall(true);

    // 🛡️ SECURITY FIX: Use credentials: 'include' for cookie-based auth
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });

    const data = await response.json();    
    if (data.success && data.lkToken) {
      const agentId = (activeCall?.fromId || activeCall?.callerData?.callerId || activeCall?.from?._id)?.toString();
      
      if (socket && agentId) {
        socket.emit("answer-call", { 
          to: agentId, 
          callId: data.roomName || callId, 
          myId: userData?._id?.toString() 
        });
      }
      
      peerConnectedRef.current = true; 
      setPeerConnected(true);
      setLiveKitToken(data.lkToken); 
      isTransitioningRef.current = false;
      setIsIncomingCall(false);
      
    } else {
      throw new Error(data.message || "LiveKit RTC token missing");
    }
  } catch (err) {
    console.error("Acceptance runtime exception:", err);
    setIsEnding(false); 
    isTransitioningRef.current = false;
    handleEndCall();
  }
};

useEffect(() => {
  if (!socket || !userData?._id) return;

  const myId = userData._id.toString();
  socket.emit("join-main-room", myId);

  const onIncoming = async (data) => {
    if (callStatusRef.current !== 'idle' || isEnding) return;

    const roomName = data.callId || data.roomName;
    setActiveCall({
      ...data,
      roomName: roomName,
      fromId: data.fromId || data.callerData?.callerId
    });
    setIsIncomingCall(true);
    setCallStatus('ringing');
    
    if (socket) {
      socket.emit("confirm-ringing", { to: data.fromId || data.callerData?.callerId });
    }

    try {
      // 🛡️ SECURITY FIX: Use credentials: 'include' for cookie-based auth
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${roomName}`, {
        method: 'GET',
        credentials: 'include'
      });
      const statusData = await res.json();
      
      if (statusData && ['rejected', 'declined', 'ended'].includes(statusData.status)) {
        handleEndCall(); 
      }
    } catch (err) {
      console.warn("Incoming check jitter ignored.");
    }
  };

  const onRemoteEnd = (data) => {
    const currentId = activeCallRef.current?.roomName || 
                      activeCallRef.current?.callId || 
                      activeCallRef.current?._id;
    const incomingId = data?.callId || data?.roomName || data?._id;

    console.log("📴 Signal Received:", { incomingId, currentId });
    if (!currentId) {
      if (callStatus !== 'idle') {
        console.log("Cleaning up zombie UI session");
        handleEndCall();
      }
      return;
    }
    if (incomingId && currentId && String(incomingId) !== String(currentId)) {
      console.warn("⏭️ Ignoring end signal: Session mismatch", { incomingId, currentId });
      return;
    }

    console.log("✅ Call termination confirmed via Socket.");
    handleEndCall();
  };

  socket.on("incoming-call", onIncoming);
  socket.on("call-ended", onRemoteEnd);
  socket.on("end-call", onRemoteEnd);
  socket.on("call-rejected", onRemoteEnd);
  socket.on("call-accepted", (data) => {});

  return () => {
    socket.off("incoming-call", onIncoming);
    socket.off("call-ended", onRemoteEnd);
    socket.off("end-call", onRemoteEnd);
    socket.off("call-rejected", onRemoteEnd);
    socket.off("call-accepted");
  };
}, [socket, userData?._id, handleEndCall]);

async function handleRejectCall() {
  console.log("🚫 User rejecting Agent call...");
  const currentCall = activeCallRef.current || activeCall;
  
  if (!currentCall) {
    console.warn("⚠️ Reject failed: No active call found in state/ref");
    handleEndCall(); 
    return;
  }
  const callId = currentCall.callId || currentCall._id || currentCall.roomName;
    const myId = userData?._id?.toString();
  const initiatorId = currentCall.fromId?.toString();
  const receiverId = currentCall.receiverId?.toString() || currentCall.toId?.toString();
  const targetId = (initiatorId === myId) ? receiverId : initiatorId;

  console.log("📡 Emitting reject-call to:", targetId, "for room:", callId);

  if (socket && targetId && callId) {
    socket.emit("reject-call", { 
      to: targetId, 
      fromId: myId, 
      callId: String(callId).trim() 
    });
  } else {
    console.error("❌ Missing Socket, Target, or CallID", { targetId, callId });
  }
  handleEndCall();
}

useEffect(() => {
  if (!socket) return;
  socket.on("new-message", (msg) => {
    setMessages(prev => {
      const isDuplicate = prev.some(m => m._id === msg._id || m.tempId === msg._id);
      if (isDuplicate) return prev;
      if (msg.senderModel === 'Agent' && notificationSound.current) {
        notificationSound.current.play().catch(() => {});
      }
      return [...prev, msg];
    });
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  });

  socket.on("message-deleted", (deletedId) => {
    setMessages(prev => prev.filter(m => (m._id || m.id) !== deletedId));
  });
  return () => {
    socket.off("new-message");
    socket.off("message-deleted");
  };
}, [socket]);
useEffect(() => {
  const setupNotifications = async () => {
    try {
      const publicKey = import.meta.env.VITE_PUBLIC_KEY;
      if (!publicKey) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }
      const response = await fetch('/api/save-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscription }) 
      });

      if (response.ok) {
        console.log("Database synced with Push Subscription");
      }
    } catch (err) {
      console.error("User Push setup failed:", err);
    }
  };

  if ('serviceWorker' in navigator && 'PushManager' in window) {
    setupNotifications();
  }
}, []);

useEffect(() => {
  const handleVoiceUpdate = (data) => {
    const remoteAudio = document.getElementById('remoteAudio');
    if (!remoteAudio) return;
    if (data.mode === 'natural' || !data.voiceId) {
      console.log("🔊 Switch to Natural: Unmuting WebRTC Stream");
      remoteAudio.muted = false;
      remoteAudio.volume = isSpeakerOn ? 1.0 : 0.7;
      remoteAudio.play().catch(e => console.warn("Audio resume failed:", e));
    } else {
      console.log("🔇 Switch to AI: Muting WebRTC Stream");
      remoteAudio.muted = true;
      remoteAudio.volume = 0;
    }
  };

  socket.on("voice-state-updated", handleVoiceUpdate);
  return () => socket.off("voice-state-updated", handleVoiceUpdate);
}, [socket, isSpeakerOn]);

useEffect(() => {
  if (!slugFromUrl) return;

  let isMounted = true;
    setLoading(true);
  const fetchUserSession = async () => {
    try {
      const url = slugFromUrl 
        ? `/api/users/my-session?slug=${slugFromUrl}` 
        : '/api/users/my-session';
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (response.status === 401 || response.status === 403) {
        navigate('/');
        return;
      }

      const data = await response.json();
      
      if (isMounted && response.ok) {
        setAgent(data.agent);
        setUserData(data.user);
        // Onboarding check remains here
        if (!data.user?.isProfileComplete) setShowOnboarding(true);
      }
    } catch (err) {
      console.error("Session fetch error:", err);
    } finally {
      if (isMounted) {
        setLoading(false); // UI will now stop "Securing" once data returns
      }
    }
  };

  fetchUserSession();
  const interval = setInterval(fetchUserSession, 30000);

  return () => {
    isMounted = false;
    clearInterval(interval);
  };
}, [navigate, slugFromUrl]);


useEffect(() => {
  const targetAgentId = agent?._id || agent?.id;
  const API_BASE_URL = import.meta.env.VITE_API_URL;
    if (!targetAgentId) return;
  const fetchMessages = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/messages/${targetAgentId}?limit=50`, {
        method: 'GET',
        credentials: 'include' 
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        const incomingMessages = data.messages;
        const lastMsg = incomingMessages[incomingMessages.length - 1];

        // 1. Silent Notification & Seen Logic
        if (
          lastMsg && 
          lastMsg.senderModel === 'Agent' && 
          lastMsg.status !== 'seen' && 
          lastMsg._id !== lastNotifiedId.current
        ) {
          lastNotifiedId.current = lastMsg._id;
          if (notificationSound.current) {
            notificationSound.current.currentTime = 0;
            notificationSound.current.play().catch(() => console.log("Audio blocked"));
          }
          if (Notification.permission === "granted") {
            new Notification(`Agent ${agent.firstName || 'ZingConnect'}`, {
              body: lastMsg.text || "Sent a file",
              icon: '/logo-s.png',
              tag: 'zing-msg'
            });
          }
          fetch(`${API_BASE_URL}/api/messages/mark-read/${targetAgentId}`, {
            method: 'PATCH',
            credentials: 'include' 
          }).catch(err => console.error("Mark read failed:", err));
        }
        setMessages(prev => {
          const inFlight = prev.filter(m => m.status === 'sending' || m.status === 'failed' || m.isTemp);
          const serverMessageIds = new Set(incomingMessages.map(msg => msg._id));
          const uniqueInFlight = inFlight.filter(m => !serverMessageIds.has(m._id) && !serverMessageIds.has(m.tempId));
          const newCombined = [...incomingMessages, ...uniqueInFlight];
          
          if (prev.length === newCombined.length && prev[prev.length-1]?._id === newCombined[newCombined.length-1]?._id) {
            return prev;
          }
          return newCombined;
        });
        if (isFirstLoad.current) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
          }, 100);
          isFirstLoad.current = false;
        }
      }
    } catch (err) {
      console.error("ZingConnect Sync Jitter:", err);
    } finally {
      if (isFirstLoad.current) setLoading(false);
    }
  };
  fetchMessages();
  const interval = setInterval(fetchMessages, 5000); 
  return () => clearInterval(interval);
}, [agent?._id, agent?.id, slugFromUrl]);

  const agentStatus = getStatusInfo(agent);

  const handlePhotoClick = () => fileInputRef.current.click();

useEffect(() => {
  const container = chatContainerRef.current;
  if (!container) return;

  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
  if (isNearBottom) {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }
}, [messages.length]);

useEffect(() => {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !loadingMore && hasMore) {
      const container = chatContainerRef.current;
      const prevScrollHeight = container.scrollHeight;
      const prevScrollTop = container.scrollTop;

      fetchOlderMessages().then(() => {
        // Restore scroll position to keep the user focused on the same messages
        requestAnimationFrame(() => {
          container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        });
      });
    }
  }, { threshold: 1.0 });

  const sentinel = scrollSentinelRef.current;
  if (sentinel) observer.observe(sentinel);
  
  return () => {
    if (sentinel) observer.unobserve(sentinel);
  };
}, [loadingMore, hasMore]);

const fetchOlderMessages = async () => {
  if (isFetchingOlder || !hasMore || !agent?._id || isAdjustingScrollRef.current) return;
  
  const targetAgentId = agent._id || agent.id;
  const API_BASE_URL = import.meta.env.VITE_API_URL;
  const oldestMessage = messages.find(m => m._id && !m.isTemp);
  
  if (!oldestMessage) return;

  setIsFetchingOlder(true);
  isAdjustingScrollRef.current = true;
  const container = chatContainerRef.current;
  const prevScrollHeight = container?.scrollHeight || 0;

  try {
    const response = await fetch(`${API_BASE_URL}/api/messages/${targetAgentId}?beforeId=${oldestMessage._id}&limit=30`, {
      method: 'GET',
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      if (data.messages.length < 30) setHasMore(false);
      
      if (data.messages.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m._id));
          const uniqueHistorical = data.messages.filter(m => !existingIds.has(m._id));
          return [...uniqueHistorical, ...prev];
        });
        requestAnimationFrame(() => {
          if (container) {
            const newHeight = container.scrollHeight;
            container.scrollTop = newHeight - prevScrollHeight;
          }
        });
      }
    }
  } catch (err) {
    console.error("Failed to load history:", err);
  } finally {
    setIsFetchingOlder(false);
    isAdjustingScrollRef.current = false;
  }
};

const handleChatScroll = (e) => {
  const container = e.currentTarget;
    if (!container || isFetchingOlder || isAdjustingScrollRef.current) return;

  if (container.scrollTop <= 50 && hasMore) {
    previousScrollHeightRef.current = container.scrollHeight;
    previousScrollTopRef.current = container.scrollTop;
        fetchOlderMessages();
  }
};

const handleFileChange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  const url = URL.createObjectURL(file);
  
  if (showOnboarding) {
    setPreviewUrl(url); 
    setFormData(prev => ({ ...prev, profileImage: file }));
  } else {
    setPreviewFile(file); // Stores the actual File object for S3 upload
    setPreviewUrl(url);   // Triggers the Fullscreen WhatsApp-style preview
    setCaption("");       // Reset caption so previous message text doesn't persist
  }
  e.target.value = ""; 
};
const handleProfileSubmit = async (e) => {
  e.preventDefault();
  
  const rawPhone = formData.phone?.raw || '';
  if (!rawPhone || rawPhone.length < 10) {
    alert("Please enter a valid phone number with country code.");
    return;
  }

  setIsUploading(true); 
  const data = new FormData();
  
  const fileToUpload = onboardingFile || previewFile;
  if (fileToUpload) {
    data.append('photo', fileToUpload);
  }

  Object.keys(formData).forEach(key => {
    if (formData[key] !== undefined && formData[key] !== null) {
      if (key === 'phone') {
        data.append(key, JSON.stringify(formData[key]));
      } else {
        data.append(key, formData[key]);
      }
    }
  });

  try {
    // 🛡️ SECURITY FIX: Use credentials: 'include' for cookie-based auth
    // Authorization header removed to prevent token exposure
    const res = await fetch('/api/users/update-profile', {
      method: 'PUT',
      credentials: 'include',
      body: data
    });

    const result = await res.json();

    if (res.ok && result.success) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);

      if (setUserData) setUserData(result.user);
      
      setShowOnboarding(false);
      setOnboardingFile(null);
      setPreviewFile(null);
      setPreviewUrl(null);
      
      console.log("Profile updated successfully.");
    } else {
      alert(result.message || "Initialization failed. Please check the form.");
    }
  } catch (err) {
    console.error("Profile initialization failed:", err);
    alert("Network error. Please check your connection.");
  } finally {
    setIsUploading(false);
  }
};

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !agent?._id) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      alert("Please upload only images or videos.");
      return;
    }
    const maxLimit = 100 * 1024 * 1024; 
    if (file.size > maxLimit) {
      alert(`This file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum allowed is 100MB.`);
      e.target.value = null; 
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const localUrl = URL.createObjectURL(file);
    setPreviewFile(file);
    setPreviewUrl(localUrl);
    setCaption(""); 
    if (e.target) e.target.value = null; 
  };

const handleFinalSend = async () => {
  if (!previewFile || isUploading || !agent?._id) return;

  const tempId = Date.now().toString();
  const detectedType = previewFile.type.startsWith('video/') ? 'video' : 'image';
  const savedFile = previewFile;
  const savedCaption = caption;

  const pendingMedia = {
    _id: tempId,
    tempId: tempId,
    senderId: userData._id,
    senderModel: 'User',
    text: savedCaption,
    fileUrl: previewUrl,
    fileType: detectedType,
    status: 'sending',
    createdAt: new Date().toISOString(),
    isTemp: true,
    originalFile: savedFile
  };

  setMessages(prev => [...prev, pendingMedia]);
  setPreviewUrl(null);
  setPreviewFile(null);

  setIsUploading(true);

  try {
    const urlResponse = await fetch('/api/messages/get-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fileName: savedFile.name, fileType: savedFile.type })
    });

    const urlData = await urlResponse.json();
    if (!urlData.success) throw new Error("Upload permission failed");

    await fetch(urlData.uploadUrl, {
      method: 'PUT',
      body: savedFile,
      headers: { 'Content-Type': savedFile.type }
    });

    const confirmResponse = await fetch('/api/messages/confirm-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        receiverId: agent._id,
        text: savedCaption.trim(),
        fileUrl: urlData.key,
        fileType: detectedType
      })
    });

    const data = await confirmResponse.json();
    if (data.success) {
      setMessages(prev => prev.map(m => m._id === tempId ? data.message : m));
      setReplyingTo(null);
    } else {
      throw new Error();
    }
  } catch (err) {
    setMessages(prev => prev.map(m => m._id === tempId ? { ...m, status: 'failed' } : m));
  } finally {
    setIsUploading(false);
  }
};

const handleDownload = async (url, type) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `zing-${type}-${Date.now()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error("Download failed:", err);
  }
};
const startStatusPolling = (roomName) => {
  const startTime = Date.now();

  if (pollingRef.current) clearInterval(pollingRef.current);

  const pollInterval = setInterval(async () => {
    if (callStatus === 'idle' || isEnding || isTransitioningRef.current) return;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${roomName}`, {
        method: 'GET',
        credentials: 'include'
      });

      if (res.status === 404) {
        if (Date.now() - startTime > 8000) {
          console.warn("Polling: Call record missing.");
          handleEndCall();
        }
        return;
      }

      const data = await res.json();
      const terminalStates = ['ended', 'rejected', 'missed', 'declined'];

      if (terminalStates.includes(data.status) || data.active === false) {
        if (Date.now() - startTime > 5000) {
          console.log("Polling: Remote side terminated call.");
          handleEndCall();
        }
      }
    } catch (err) {
      console.warn("Status sync jitter:", err.message);
    }
  }, 4000);

  pollingRef.current = pollInterval;
};
const handleStartCall = async () => {
  const currentUserId = userData?._id || userData?.id;
  const currentAgentId = agent?._id || agent?.id;
  const API_BASE_URL = import.meta.env.VITE_API_URL;

  if (!currentAgentId || !currentUserId) {
    alert("Profile data still loading. Please try again.");
    return;
  }
  
  setCallStatus('calling'); 
  setShowFullScreenCall(true);

  try {
    const res = await fetch(`${API_BASE_URL}/api/calls/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ 
        receiverId: currentAgentId, 
        receiverModel: 'Agent',
        voiceId: "natural" 
      })
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || "Agent unavailable");
    }

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
    console.error("Call initialization failed:", err);
    handleEndCall();
  }
};
const handleSendMessage = async (e) => {
  e.preventDefault();
  // Ensure we have necessary data
  if (!newMessage.trim() || !agent?._id) return;
  
  const textToSend = newMessage;
  const tempId = Date.now().toString(); 
  setNewMessage(''); 

  const pendingMessage = {
    _id: tempId,
    tempId: tempId,
    senderId: userData._id,
    senderModel: 'User',
    text: textToSend,
    status: 'sending',
    createdAt: new Date().toISOString(),
    isTemp: true
  };

  setMessages(prev => [...prev, pendingMessage]);
  // Use scrollIntoView properly
  setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

  try {
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        receiverId: agent._id,
        receiverModel: 'Agent', // ADDED: Must match backend expectation
        text: textToSend,
        fileType: 'text',
        replyToId: replyingTo?._id 
      })
    });

    const data = await response.json();
    
    if (!response.ok || !data.success) throw new Error(data.message || "Failed to send");

    // SUCCESS: Backend handles the socket emit, so we just update the UI state.
    setMessages(prev => prev.map(m => m._id === tempId ? data.message : m));
    setReplyingTo(null);
    
  } catch (err) {
    console.error("Message send failed:", err);
    setMessages(prev => prev.map(m => 
      m._id === tempId ? { ...m, status: 'failed' } : m
    ));
  }
};

const handleResend = (msg) => {
  setMessages(prev => prev.filter(m => m._id !== msg._id));
  if (msg.fileType === 'image' || msg.fileType === 'video') {
    setPreviewFile(msg.originalFile);
    setPreviewUrl(msg.fileUrl);
    setCaption(msg.text);
  } else {
    setNewMessage(msg.text);
  }
};

function AudioTracks({ active }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Microphone, filter: (track) => track.isRemote },
    ],
    { updateOnlyOnChanges: true },
  );

  return null; // This component doesn't need to render anything visual
};

const MessageBubble = ({ m, isMe, onReply, children }) => {
  const controls = useAnimation();
  const bind = useDrag(({ active, movement: [x], last }) => {
    const xMovement = Math.min(Math.max(0, x), 100); 

    if (active) {
      controls.set({ x: xMovement });
    }

    if (last) {
      if (xMovement > 60) {
        onReply(m);
        if (window.navigator.vibrate) window.navigator.vibrate(10);
      }
      controls.start({ x: 0, transition: { type: "spring", stiffness: 300, damping: 30 } });
    }
  }, { axis: 'x' });

  return (
    <div className="relative group">
      {/* The Hidden Reply Icon */}
      <div className="absolute left-[-40px] inset-y-0 flex items-center opacity-0 group-active:opacity-100 transition-opacity">
        <div className="bg-gray-200 p-2 rounded-full">
          <BsReplyFill className="text-gray-600" size={18} />
        </div>
      </div>

      <motion.div 
        {...bind()} 
        animate={controls}
        className={`max-w-[85%] md:max-w-[65%] px-3 py-1.5 rounded-lg shadow-sm relative animate-in fade-in slide-in-from-bottom-1 ${
          isMe ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
        } mb-1`}
      >
        {children}
      </motion.div>
    </div>
  );
};


if (loading && !agent) {
  return (
    <div className="h-screen flex items-center justify-center bg-[#f0f2f5] text-[10px] font-black uppercase tracking-[0.2em] text-blue-900 animate-pulse">
      Securing Connection...
    </div>
  );
}

// 2. If loading has finished but we still don't have an agent, handle the error gracefully
if (!loading && !agent) {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[#f0f2f5] text-red-600">
      <p className="font-bold">Connection Failed</p>
      <button 
        onClick={() => window.location.reload()} 
        className="mt-4 underline text-xs"
      >
        Retry Connection
      </button>
    </div>
  );
}
  return (
    <div className="h-screen w-screen bg-[#f0f2f5] flex overflow-hidden font-sans antialiased text-slate-900 relative">
      
      {/* --- AGENT PROFILE SIDEBAR --- */}
      <aside className={`absolute top-0 right-0 h-full w-[280px] md:w-[350px] bg-white border-l border-gray-100 shadow-2xl z-[100] transform transition-transform duration-300 ease-in-out flex flex-col ${
        showProfilePanel ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <header className="p-4 flex items-center justify-between border-b border-gray-100">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-900">Verified Identity</p>
            <button onClick={() => setShowProfilePanel(false)} className="text-gray-400 hover:text-blue-600 transition-colors p-1">
                <BsArrowRight size={18} />
            </button>
        </header>
        
        <main 
        className="flex-1 p-6 flex flex-col items-center text-center space-y-5 overflow-y-auto scrollbar-hide pb-10">
            <div className="w-24 h-24 rounded-[2rem] bg-gray-100 border-4 border-white shadow-lg overflow-hidden flex items-center justify-center relative">
                {agent?.photoUrl ? (
                    <img src={agent.photoUrl} alt="Agent" className="w-full h-full object-cover" />
                ) : (
                    <span className="text-2xl font-black text-blue-600">{agent?.firstName?.[0]}</span>
                )}
                <div className={`absolute bottom-2 right-2 w-4 h-4 rounded-full border-2 border-white ${agentStatus.isOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
            </div>
            
            <div className="space-y-1">
                <h3 className="text-lg font-black text-blue-950">
                    {agent?.firstName} {agent?.lastName}
                </h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                    Node ID: {agent?.slug || '---'}
                </p>
            </div>

            <div className="w-full text-left space-y-4 pt-4 border-t border-gray-100">
                <div className="grid grid-cols-1 gap-3">
                  <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                    <p className="text-[8px] font-black uppercase tracking-widest text-blue-600">Official Designation</p>
                    <p className="text-xs font-bold text-blue-950 mt-0.5">{agent?.occupation || 'Authorized Agent'}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Program Authority</p>
                    <p className="text-xs font-bold text-slate-700 mt-0.5">{agent?.program || 'Verified Program'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-1">
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Gender</p>
                    <p className="text-xs font-bold text-gray-700 capitalize">{agent?.gender || 'N/A'}</p>
                  </div>
                  <div className="p-1">
                    <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">Date of Birth</p>
                    <p className="text-xs font-bold text-gray-700">
                       {agent?.dob ? new Date(agent.dob).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Professional Bio</p>
                    <p className="text-sm text-slate-600 leading-relaxed bg-gray-50 p-4 rounded-xl italic">
                       "{agent?.bio || "Secured communications specialist."}"
                    </p>
                </div>
            </div>
        </main>
      </aside>

{/* --- ONBOARDING OVERLAY --- */}
{showOnboarding && !userData?.isProfileComplete && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/40 backdrop-blur-md md:backdrop-blur-lg">
    
    {/* Modern Backdrop Flourish Elements for Premium UI Look */}
    <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none hidden md:block" />
    <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none hidden md:block" />

    {/* Main Card Element */}
    <div className="w-full max-w-md bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-2xl shadow-slate-900/10 relative transform animate-in fade-in zoom-in-95 duration-300 flex flex-col my-auto">
      
      {/* Decorative Top Accent Tag */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-b-full shadow-sm" />

      {/* Typography Header Block */}
      <div className="text-center space-y-1.5 mb-6 md:mb-8">
        <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight leading-none uppercase">
          Initialize Profile
        </h2>
        <div className="flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-[10px] md:text-xs text-slate-400 font-bold uppercase tracking-[0.15em]">
            Secure Verification Required
          </p>
        </div>
      </div>

      <form onSubmit={handleProfileSubmit} className="space-y-4">
        
        {/* Dynamic Avatar Picker Slot */}
        <div className="flex flex-col items-center mb-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            className="hidden" 
          />
          <div 
            onClick={handlePhotoClick} 
            className="w-20 h-20 bg-slate-50 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 relative cursor-pointer hover:border-blue-500 hover:bg-blue-50/20 transition-all duration-200 group overflow-hidden shadow-inner"
          >
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            ) : (
              <BsCameraFill size={22} className="group-hover:text-blue-500 group-hover:scale-110 transition-transform" />
            )}
            {!previewUrl && (
              <span className="absolute bottom-1 bg-slate-900 text-white text-[7px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider scale-90 group-hover:bg-blue-600 transition-colors">
                Add Photo
              </span>
            )}
          </div>
        </div>

        {/* First & Last Name Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">First Name</label>
            <input 
              required 
              type="text"
              placeholder="John" 
              value={formData.firstName || ''}
              className="w-full bg-slate-50/80 border border-slate-100 p-3 h-11 rounded-xl text-xs md:text-sm font-semibold text-slate-800 placeholder:text-slate-300 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all" 
              onChange={e => setFormData(prev => ({ ...prev, firstName: e.target.value }))} 
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Last Name</label>
            <input 
              required 
              type="text"
              placeholder="Doe" 
              value={formData.lastName || ''}
              className="w-full bg-slate-50/80 border border-slate-100 p-3 h-11 rounded-xl text-xs md:text-sm font-semibold text-slate-800 placeholder:text-slate-300 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all" 
              onChange={e => setFormData(prev => ({ ...prev, lastName: e.target.value }))} 
            />
          </div>
        </div>

        {/* Phone Number Wrapper */}
        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">
            Phone Number
          </label>
          <div className="modern-phone-input-styles">
            <PhoneInput
              country={'us'}
              value={formData.phone?.raw || ''} 
              onChange={(value, countryData, event, formattedValue) => {
                setFormData(prev => ({ 
                  ...prev, 
                  phone: {
                    raw: value,
                    formatted: formattedValue,
                    countryCode: countryData.countryCode || 'us',
                    dialCode: countryData.dialCode || '1'
                  }
                }));
              }}
              containerClass="phone-container"
              inputClass="phone-input-field"
              buttonClass="phone-dropdown-button"
              placeholder="Enter phone number"
              enableSearch={true} 
            />
          </div>
        </div>

        {/* Date of Birth & Gender Selection */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Date of Birth</label>
            <input 
              required 
              type="date" 
              value={formData.dob || ''}
              className="w-full bg-slate-50/80 border border-slate-100 px-3 h-11 rounded-xl text-xs md:text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all" 
              onChange={e => setFormData(prev => ({ ...prev, dob: e.target.value }))} 
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Gender</label>
            <div className="relative">
              <select 
                required 
                className="w-full bg-slate-50/80 border border-slate-100 px-3 h-11 rounded-xl text-xs md:text-sm font-semibold text-slate-800 outline-none appearance-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all" 
                onChange={e => setFormData(prev => ({ ...prev, gender: e.target.value }))} 
                value={formData.gender || ''}
              >
                <option value="" disabled>Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
              <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-slate-400 text-xxs">
                ▼
              </div>
            </div>
          </div>
        </div>

        {/* City & State Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">City</label>
            <input 
              required 
              type="text"
              placeholder="Los Angeles" 
              value={formData.city || ''}
              className="w-full bg-slate-50/80 border border-slate-100 p-3 h-11 rounded-xl text-xs md:text-sm font-semibold text-slate-800 placeholder:text-slate-300 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all" 
              onChange={e => setFormData(prev => ({ ...prev, city: e.target.value }))} 
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">State</label>
            <input 
              required 
              type="text"
              placeholder="California" 
              value={formData.state || ''}
              className="w-full bg-slate-50/80 border border-slate-100 p-3 h-11 rounded-xl text-xs md:text-sm font-semibold text-slate-800 placeholder:text-slate-300 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all" 
              onChange={e => setFormData(prev => ({ ...prev, state: e.target.value }))} 
            />
          </div>
        </div>

        {/* Premium Launch Action Button */}
        <button 
          type="submit" 
          disabled={isUploading}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white h-12 rounded-xl font-black text-[11px] md:text-xs uppercase tracking-widest hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all shadow-lg shadow-blue-500/20 mt-4 flex items-center justify-center gap-2"
        >
          {isUploading ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            "Launch Dashboard"
          )}
        </button>
      </form>
    </div>
  </div>
)}
      {/* --- MAIN INTERFACE --- */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[55px] md:h-[65px] bg-[#f0f2f5] px-3 md:px-6 flex justify-between items-center z-20 border-b border-gray-200 shadow-sm">
          <div className="flex items-center gap-2 md:gap-4 flex-1">
            <button onClick={() => navigate(-1)} className="p-1 md:hidden text-gray-600">
              <BsChevronLeft size={20} />
            </button>
            
            <div className="relative">
              <div className="w-9 h-9 md:w-11 md:h-11 bg-white rounded-full overflow-hidden border border-gray-200 flex items-center justify-center">
                {agent?.photoUrl ? (
                  <img src={agent.photoUrl} alt="Agent" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-black text-blue-600">{agent?.firstName?.[0]}</span>
                )}
              </div>
              <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-2 border-[#f0f2f5] rounded-full ${agentStatus.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
            </div>

            <div onClick={() => setShowProfilePanel(true)} className="flex flex-col cursor-pointer hover:bg-black/5 p-1 rounded transition-colors overflow-hidden">
              <h1 className="text-[13px] md:text-[15px] font-bold text-gray-800 leading-tight truncate">
              {agent?.firstName ? `${agent.firstName} ${agent.lastName}` : 'Loading Agent...'}
              </h1>
              <p className={`text-[9px] md:text-[10px] font-bold uppercase tracking-tighter ${agentStatus.isOnline ? 'text-green-600' : 'text-gray-500'}`}>
                {agentStatus.label}
              </p>
            </div>
          </div>

        <div className="flex items-center gap-5 md:gap-8 text-gray-500 pr-1">
<BsGearFill 
  className="cursor-pointer hover:text-gray-700 transition-colors active:scale-90" 
  size={18} 
onClick={() => navigate(`/user/profile/${slugFromUrl}`)}
/>
</div>
        </header>
        <main 
  ref={chatContainerRef}
  onScroll={handleChatScroll}
  className="flex-1 relative overflow-y-auto bg-[#efeae2] p-4 md:px-[15%] lg:px-[25%] flex flex-col space-y-2 scrollbar-hide"
  style={{
    scrollAnchor: 'none',            
    overscrollBehaviorY: 'contain',  
    WebkitOverflowScrolling: 'touch'  
  }}
>
   {/* Fetching State Indicator */}
  {isFetchingOlder && (
    <div className="self-center z-20 my-2 px-3 py-1.5 bg-[#005c4b] text-white rounded-full text-[10px] font-bold tracking-wider flex items-center gap-2 shadow-md border border-emerald-500/20 animate-pulse">
      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      <span>LOADING OLDER MESSAGES...</span>
    </div>
  )}


  {/* 1. Background Pattern */}
  <div 
    className="absolute inset-0 opacity-[0.05] pointer-events-none" 
    style={{ backgroundImage: "url('https://w0.peakpx.com/wallpaper/580/678/OH-wallpaper-whatsapp-dark-mode.jpg')" }} 
  />

  {/* 2. Encryption Notice */}
  <div className="self-center z-10 my-4 px-4 py-1.5 bg-[#fff9c2] rounded-lg shadow-sm border border-yellow-100 flex items-center gap-2 max-w-[90%]">
    <BsShieldLockFill size={10} className="text-gray-600" />
    <p className="text-[9px] md:text-[10px] text-gray-600 text-center font-medium leading-tight">
      Messages are end-to-end encrypted. No one outside of this chat can read them.
    </p>
  </div>

  {/* 3. Message List */}
  {messages.map((m) => {
    const msgKey = m._id || m.tempId || `temp-${m.createdAt}`;

    if (m.fileType === 'voice_call') {
      return (
        <CallStatusMessage 
          key={msgKey}
          status={m.status}
          time={new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        />
      );
    }

    const isMe = m.senderModel === 'User' || m.senderId === userData?._id;

    return (
      <div 
        key={msgKey} 
        className={`max-w-[85%] md:max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm relative z-10 animate-in fade-in slide-in-from-bottom-2 flex flex-col shrink-0 ${
          isMe ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
        } mb-3`}
      >
        {/* Media Handling */}
        {(m.fileType === 'image' || m.fileType === 'video') && (
          <div className="relative mb-2 mt-1 group">
            {m.fileType === 'image' ? (
              <>
                <img 
                  src={m.fileUrl} 
                  alt="attachment" 
                  onClick={() => setFullscreenImage(m.fileUrl)} 
                  className="rounded-lg bg-gray-100 object-cover w-full max-w-[260px] max-h-[300px] md:max-w-[380px] md:max-h-[450px] cursor-pointer" 
                  onError={(e) => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/150?text=Image+Unavailable'; }}
                />
                <button onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'image'); }} className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><BsDownload size={14} /></button>
              </>
            ) : (
              <div className="relative">
                <video className="rounded-lg w-full max-w-[260px] md:max-w-[380px] max-h-[450px] bg-black cursor-pointer" onClick={() => setFullscreenVideo(m.fileUrl)}>
                  <source src={m.fileUrl} type="video/mp4" />
                </video>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 p-3 rounded-full text-white"><BsPlayFill size={30} /></div></div>
                <button onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'video'); }} className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><BsDownload size={14} /></button>
              </div>
            )}
          </div>
        )}

        {m.text && (
          <p className={`text-[12px] md:text-[14px] leading-relaxed pr-6 break-words ${m.fileType ? 'mt-1 mb-1' : ''}`}>
            {m.text}
          </p>
        )}

        <div className="flex items-center justify-end gap-1 mt-1 border-t border-black/5 pt-0.5 min-w-[70px]">
          <span className="text-[9px] text-gray-400 font-bold uppercase">
            {new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {isMe && (
            <div className="flex items-center ml-1">
              {m.status === 'sending' && <div className="w-2.5 h-2.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />}
              {m.status === 'failed' && <button onClick={() => handleResend(m)} className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[8px] font-black uppercase">Retry</button>}
              {(!m.status || m.status === 'sent' || m.status === 'seen') && (
                <BsCheckAll className={m.status === 'seen' ? "text-blue-500" : "text-gray-400"} size={16} />
              )}
            </div>
          )}
        </div>
      </div>
    );
  })}

  <div ref={messagesEndRef} className="h-12 shrink-0 w-full clear-both" />
</main>

{/* --- UPDATED WHATSAPP PREVIEW FOR USER DASHBOARD --- */}
{previewUrl && !showOnboarding && (
    <div className="absolute inset-0 z-[500] bg-black/90 flex flex-col animate-in fade-in zoom-in duration-200">
    {/* Header */}
    <div className="p-4 flex justify-between items-center text-white">
      <button 
        onClick={() => { 
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null); 
          setPreviewFile(null); // Ensure this matches your state name
        }} 
        className="p-2 hover:bg-white/10 rounded-full transition-colors"
      >
        <BsChevronLeft size={24} />
      </button>
      <span className="font-bold uppercase tracking-widest text-[10px]">Preview Media</span>
      <div className="w-10" /> 
    </div>

    {/* Dynamic Media Preview Container */}
    <div className="flex-1 flex items-center justify-center p-4">
      {previewFile?.type?.startsWith('video/') ? (
        <video 
          key={previewUrl}
          src={previewUrl} 
          controls 
          autoPlay 
          muted
          playsInline
          className="max-h-full max-w-full rounded-lg shadow-2xl bg-black"
        />
      ) : (
        <img 
          src={previewUrl} 
          alt="Preview" 
          className="max-h-full max-w-full object-contain rounded-lg shadow-2xl" 
        />
      )}
    </div>

    {/* Caption Input Area */}
    <div className="p-4 bg-black/40 backdrop-blur-md">
      <div className="max-w-4xl mx-auto flex items-end gap-3 bg-white/10 p-2 rounded-2xl border border-white/20">
        <input
          type="text"
          placeholder="Add a caption..."
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          className="flex-1 bg-transparent text-white px-4 py-3 outline-none text-sm"
          autoFocus
        />
        <button 
          onClick={handleFinalSend}
          disabled={isUploading}
          className="bg-blue-600 text-white p-4 rounded-xl hover:bg-blue-700 active:scale-95 transition-all shadow-lg"
        >
          {isUploading ? (
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
          ) : (
            <BsSendFill size={20} />
          )}
        </button>
      </div>
    </div>
  </div>
)}

<footer className="shrink-0 bg-[#f0f2f5] z-20 border-t border-gray-200 pb-safe">
    
    {/* --- 1. REPLY PREVIEW PANEL --- */}
    {replyingTo && (
      <div className="px-2 md:px-6 pt-2">
        <div className="bg-white/80 backdrop-blur-md rounded-t-2xl border-l-4 border-blue-600 flex items-center justify-between overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-200">
          <div className="p-3 flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-600 truncate">
              Replying to {replyingTo.senderModel === 'User' ? 'You' : (agent?.firstName || 'Agent')}
            </p>
            <p className="text-[13px] text-slate-600 truncate mt-0.5 leading-tight">
              {replyingTo.fileType === 'image' ? (
                <span className="flex items-center gap-1 font-medium text-blue-500"><BsCameraFill size={12}/> Photo</span>
              ) : replyingTo.fileType === 'video' ? (
                <span className="flex items-center gap-1 font-medium text-blue-500"><BsPlayFill size={14}/> Video</span>
              ) : (
                replyingTo.text
              )}
            </p>
          </div>

          {replyingTo.fileUrl && (
            <div className="w-12 h-12 bg-gray-100 shrink-0 ml-2">
              {replyingTo.fileType === 'image' ? (
                <img src={replyingTo.fileUrl} className="w-full h-full object-cover opacity-90" alt="Reply thumb" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
                  <BsPlayFill size={20} />
                </div>
              )}
            </div>
          )}

          <button 
            onClick={() => setReplyingTo(null)}
            className="p-3 text-slate-400 hover:text-red-500 transition-colors"
          >
            <BsPlusLg className="rotate-45" size={18} />
          </button>
        </div>
      </div>
    )}

  {/* --- MAIN INPUT CONTROLS --- */}
   <div className="px-2 md:px-6 py-3 flex items-center gap-2 md:gap-3">
    <input  type="file"  ref={fileInputRef}  onChange={handleFileUpload}  accept="image/*,video/*"  className="hidden"/>
{/* Optimized for Camera */}
<input 
  type="file" 
  ref={cameraInputRef} 
  onChange={handleFileUpload} 
  accept="image/*;capture=camera,video/*;capture=camcorder"
  capture="environment" 
  className="hidden" 
/>

    <div className="flex gap-1 md:gap-2 text-gray-500">
      <button type="button" onClick={() => fileInputRef.current.click()} disabled={isUploading} 
        className="p-2 hover:bg-black/5 rounded-full transition-colors active:scale-90">
        <BsPaperclip size={22} />
      </button>

     <button type="button" onClick={triggerCamera} disabled={isUploading}
  className="p-2 hover:bg-black/5 rounded-full transition-colors active:scale-90">
  <BsCameraFill size={22} />
</button>
    </div>
    
    <form onSubmit={handleSendMessage} className="flex-1 flex items-center gap-2">
      <div className="flex-1 relative flex items-center">
        <input 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)} 
          disabled={isUploading}
          placeholder={isUploading ? "Uploading file..." : (replyingTo ? "Write a reply..." : "Type your secure message")} 
          className={`w-full bg-white px-4 py-2.5 md:py-3 text-[14px] outline-none shadow-sm border border-gray-100 focus:ring-1 ring-blue-500/20 transition-all ${
            replyingTo ? 'rounded-b-2xl rounded-t-none border-t-0' : 'rounded-full'
          }`}
        />
      </div>
      
      {/* ALWAYS SHOW SEND BUTTON, REMOVED MIC TOGGLE */}
      <button 
        type="submit" 
        disabled={!newMessage.trim() && !isUploading}
        className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all shrink-0 ${
          newMessage.trim() 
            ? "bg-blue-600 text-white" 
            : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"
        }`}
      >
        <BsSendFill size={16} className="ml-0.5" />
      </button>
    </form>
  </div>
</footer>
      </div>
{/* --- 3. SECURITY ONBOARDING --- */}
{!hasInteracted && (
  <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 touch-none">
    <button 
      type="button" 
      onClick={unlockAudio} 
      className="bg-white p-5 md:p-8 rounded-[2rem] shadow-2xl text-center space-y-3 max-w-[280px] md:max-w-xs border border-blue-100 cursor-pointer select-none active:bg-slate-50 transition-colors w-full focus:outline-none"
      style={{ pointerEvents: 'auto', WebkitTapHighlightColor: 'transparent' }}
    >
      <div className="bg-blue-50 w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center mx-auto shrink-0">
        <BsShieldLockFill className="text-blue-600 w-5 h-5 md:w-7 md:h-7" />
      </div>
      
      <div className="space-y-1">
        <h2 className="text-lg md:text-xl font-black text-blue-950 tracking-tight">Security Sync</h2>
        <p className="text-gray-500 text-[11px] md:text-sm font-semibold leading-snug md:leading-relaxed px-1">
          Tap to authenticate your session and enable secure message alerts.
        </p>
      </div>

      <div className="bg-blue-600 text-white py-2.5 md:py-3 px-6 md:px-8 rounded-xl font-black text-[11px] md:text-sm tracking-widest uppercase shadow-md shadow-blue-600/20 pointer-events-none mt-2">
        SYNC & ENTER
      </div>
    </button>
  </div>
)}

    {/* --- FULLSCREEN IMAGE OVERLAY (LIGHTBOX) --- */}
{fullscreenImage && (
  <div 
    className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-200"
    onClick={() => setFullscreenImage(null)}
  >
    {/* Top Navigation Bar */}
    <div className="absolute top-0 w-full p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-10">
      <button 
        onClick={() => setFullscreenImage(null)}
        className="text-white/70 hover:text-white transition-colors"
      >
        <BsChevronLeft size={30} />
      </button>

      {/* DOWNLOAD BUTTON */}
      <button 
        onClick={(e) => { 
          e.stopPropagation(); // Stops the overlay from closing when downloading
          handleDownload(fullscreenImage, 'image'); 
        }}
        className="bg-white text-black px-5 py-2.5 rounded-full flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider shadow-2xl active:scale-95 transition-all"
      >
        <BsDownload size={18} />
        <span>Save to Device</span>
      </button>
    </div>

    {/* The Image */}
    <img 
      src={fullscreenImage} 
      className="max-w-[95%] max-h-[85%] object-contain shadow-2xl" 
      alt="Full view" 
      onClick={(e) => e.stopPropagation()} // Prevents closing if the user clicks the image itself
    />
    
    <p className="absolute bottom-10 text-white/40 text-[10px] uppercase tracking-[0.2em] font-medium">
      Secure Preview Mode
    </p>
  </div>
)}

{/* --- FULLSCREEN VIDEO OVERLAY --- */}
{fullscreenVideo && (
  <div 
    className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-200"
    onClick={() => setFullscreenVideo(null)} // Click background to close
  >
    {/* Top Navigation Bar */}
    <div className="absolute top-0 w-full p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-10">
      <button 
        onClick={() => setFullscreenVideo(null)}
        className="text-white/70 hover:text-white transition-colors"
      >
        <BsChevronLeft size={30} />
      </button>

      {/* DOWNLOAD BUTTON */}
      <button 
        onClick={(e) => { 
          e.stopPropagation(); // Prevents overlay from closing
          handleDownload(fullscreenVideo, 'video'); 
        }}
        className="bg-white text-black px-5 py-2.5 rounded-full flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider shadow-2xl active:scale-95 transition-all"
      >
        <BsDownload size={18} />
        <span>Save Video</span>
      </button>
    </div>

    {/* The Video Element */}
    <video 
      src={fullscreenVideo} 
      controls 
      autoPlay 
      className="max-w-[95%] max-h-[85%] shadow-2xl rounded-lg" 
      onClick={(e) => e.stopPropagation()} // Clicking video won't close overlay
    >
      Your browser does not support the video tag.
    </video>
    
    <p className="absolute bottom-10 text-white/40 text-[10px] uppercase tracking-[0.2em] font-medium">
      Video Preview Mode
    </p>
  </div>
)}

{/* --- UNIFIED SECURE CALL INTERFACE --- */}
{callStatus !== 'idle' && (
  <div className="fixed inset-0 z-[10000] bg-[#0b141a] flex flex-col items-center justify-between py-20 animate-in fade-in zoom-in duration-300 text-white">
    
   {/* 1. IDENTITY SECTION */}
<div className="flex flex-col items-center gap-6 mt-10">
  <div className="relative">
    <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-2 border-white/10 overflow-hidden shadow-2xl relative z-10 bg-slate-800">
      <img 
        src={
          isIncomingCall 
            ? (
                activeCall?.from?.photoUrl || // Check nested from object
                activeCall?.agentData?.photoUrl || // Check agentData if sent
                activeCaller?.photoUrl || 
                "/default-user.png"
              )
            : (agent?.photoUrl || activeCall?.photoUrl || "/default-agent.png")
        } 
        className="w-full h-full object-cover" 
        alt="Caller Identity"
        onError={(e) => {
          e.target.src = "/default-agent.png"; // Final fallback if URL is broken
        }}
      />
    </div>
    
    {/* Animated Pulse Rings */}
    {(callStatus === 'ringing' || callStatus === 'calling' || callStatus === 'connecting') && (
      <div className="absolute inset-0 w-full h-full border-4 border-blue-500 rounded-full animate-ping opacity-20" />
    )}
  </div>

  <div className="text-center space-y-2">
    <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
      {isIncomingCall 
        ? (
            activeCall?.from?.firstName ? `${activeCall.from.firstName} ${activeCall.from.lastName}` :
            activeCall?.fromName || 
            activeCaller?.fromName || 
            "Incoming Call"
          )
        : (agent ? `${agent.firstName} ${agent.lastName}` : "Secure Connection")
      }
    </h2>
    
    <div className="flex items-center justify-center gap-2">
      {callStatus === 'connected' ? (
        <>
          <BsShieldLockFill className="text-green-500" size={14} />
          <span className="text-green-500 text-sm font-bold tracking-[0.2em] italic uppercase">
            Line Encrypted • {formatTime(callTime)}
          </span>
        </>
      ) : (
        <span className="text-blue-400 text-sm uppercase tracking-[0.3em] font-black animate-pulse">
          {callStatus === 'ringing' ? 'Ringing...' : 
           callStatus === 'calling' ? 'Establishing Line...' : 
           'Connecting Peer...'}
        </span>
      )}
    </div>
  </div>
</div>

 {/* 2. DYNAMIC CONTROL INTERFACE */}
<div className="flex flex-col items-center gap-12 mb-10 w-full px-10">
  
  {/* State A: RINGING (Incoming) - Show Accept/Decline */}
  {callStatus === 'ringing' && isIncomingCall ? (
    <div className="flex items-center gap-16 md:gap-24">
      {/* REJECT/DECLINE BUTTON */}
      <div className="flex flex-col items-center gap-3">
        <button 
          onClick={handleRejectCall} // 👈 CHANGED THIS from handleEndCall
          className="bg-red-500 w-20 h-20 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/40 hover:bg-red-600 transition-transform active:scale-90"
        >
           <BsTelephoneFill className="rotate-[135deg] text-white" size={32} />
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">Decline</span>
      </div>

      {/* ACCEPT BUTTON */}
      <div className="flex flex-col items-center gap-3">
        <button 
          onClick={handleAcceptCall} 
          className="bg-green-500 w-20 h-20 rounded-full flex items-center justify-center shadow-2xl shadow-green-500/40 animate-bounce hover:bg-green-600 transition-transform active:scale-95"
        >
           <BsTelephoneFill className="text-white" size={32} />
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-green-500">Accept</span>
      </div>
    </div>
  ) : (
    /* State B: CALLING, CONNECTING, or CONNECTED - Show Active Controls */
    <>
      <div className="flex items-center justify-around w-full max-w-xs text-white/60">
        {/* Speaker and Mute buttons remain the same */}
        <button onClick={() => setIsSpeakerOn(!isSpeakerOn)} className="flex flex-col items-center gap-2 group">
          <div className={`p-4 rounded-full transition-all ${isSpeakerOn ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/5 group-hover:bg-white/10'}`}>
            <BsVolumeUpFill size={24}/>
          </div>
          <span className={`text-[9px] font-bold uppercase tracking-tighter ${isSpeakerOn ? 'text-blue-400' : ''}`}>Speaker</span>
        </button>

        <button onClick={() => setIsMuted(!isMuted)} className="flex flex-col items-center gap-2 group">
          <div className={`p-4 rounded-full transition-all ${isMuted ? 'bg-red-600 text-white shadow-lg' : 'bg-white/5 group-hover:bg-white/10'}`}>
            {isMuted ? <BsMicMuteFill size={24}/> : <BsMicFill size={24}/>}
          </div>
          <span className={`text-[9px] font-bold uppercase tracking-tighter ${isMuted ? 'text-red-400' : ''}`}>Mute</span>
        </button>
      </div>

      {/* END CALL BUTTON (Centered) */}
      <div className="flex flex-col items-center gap-3">
        <button 
          onClick={handleEndCall} // 👈 Keep handleEndCall here because the call is already active/connecting
          className="bg-red-500 w-24 h-24 rounded-full text-white flex items-center justify-center shadow-2xl shadow-red-500/50 hover:bg-red-600 transition-all active:scale-90"
        >
          <BsTelephoneFill className="rotate-[135deg]" size={38}/>
        </button>
        <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">End Call</span>
      </div>
    </>
  )}
</div>

    {/* 3. ENCRYPTION BADGE */}
    <div className="flex items-center gap-2 opacity-30">
      <BsShieldLockFill size={12} />
      <span className="text-[9px] font-bold uppercase tracking-[0.2em]">End-to-End Encrypted Session</span>
    </div>
  </div>
)}

{liveKitToken && (
  <LiveKitRoom
    video={false}
    audio={true}
    token={liveKitToken}
    serverUrl={import.meta.env.VITE_LIVEKIT_URL}
    connect={!!liveKitToken}
    options={{
      publishDefaults: {
        audioPreset: { maxBitrate: 32000 }, 
        dtx: true,                          
      },
      adaptiveStream: true,
    }}
    onConnected={async () => {
      console.log("⚡ ZingConnect: Audio Bridge Established via WebRTC Mesh.");
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          if (ctx.state === 'suspended') await ctx.resume();
        }
      } catch (e) {
        console.warn("⚠️ ZingConnect: Manual audio wake-up failed:", e);
      }
      if (ringtoneAudio.current) {
        ringtoneAudio.current.pause();
        ringtoneAudio.current.currentTime = 0;
      }
      peerConnectedRef.current = true;
      setPeerConnected(true);
      setCallStatus('connected');
      setIsIncomingCall(false); 
    }}
    onDisconnected={() => {
      if (!isEnding) {
        console.log("📡 ZingConnect: LiveKit connection lost. Cleaning up session.");
        handleEndCall();
      }
    }}
  >
    <AudioSession 
      isMuted={isMuted} 
      isMasked={activeCall?.voiceId && activeCall.voiceId !== 'natural'} 
    />
  </LiveKitRoom>
)}

    </div>
  );
};

export default UserDashboard;