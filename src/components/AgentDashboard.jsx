import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'simple-peer/simplepeer.min.js'; 
import { Buffer } from 'buffer'; 
import { 
  LiveKitRoom, AudioConference, useTracks, RoomAudioRenderer, useLocalParticipant, StartAudio, useRoomContext
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { 
  BsSearch, BsThreeDotsVertical, BsCheckAll, BsCheck, BsPersonCircle, BsChevronLeft, BsShieldLockFill, BsCreditCard2BackFill, BsChevronDown,
  BsShieldFillExclamation, BsCheckCircleFill, BsVolumeUpFill, BsDownload, BsTelephoneOutboundFill, BsPlayFill, BsMicFill,
  BsTelephoneFill, BsTelephoneXFill, BsMicMuteFill, BsXLg, BsGearFill, BsPlusLg, BsPlus, BsSend, BsSendFill, BsPaperclip,
  BsCameraFill  
} from 'react-icons/bs';
import { useAgentCall } from '../context/AgentCallContext';

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

// Singleton socket instance prevents re-initialization on component changes
const socket = io(import.meta.env.VITE_API_URL);

export const AgentDashboard = () => {
  const navigate = useNavigate();
  
  const messagesEndRef = useRef(null);
  const connectionTimeoutRef = useRef(null);
  const localAudioRef = useRef(null);
  const scrollRef = useRef(null);
  const userStreamRef = useRef(null);
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));  
  const lastNotifiedId = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const timerRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const pollingIntervalRef = useRef(null);

  const pollingRef = useRef(null); 
  const aiMediaRecorderRef = useRef(null);

  const [agentData, setAgentData] = useState(null);
  const [users, setUsers] = useState([]); 
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [limit, setLimit] = useState(30); 
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('online');
  const [peerConnected, setPeerConnected] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [isVoiceConversionActive, setIsVoiceConversionActive] = useState(false);
  const [isDualLoginConflict, setIsDualLoginConflict] = useState(false);
  const [holdTimer, setHoldTimer] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isEnding, setIsEnding] = useState(false);

 
  // Subscription States
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("BASIC");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);  
  const [isUploading, setIsUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null); 
  const [previewUrl, setPreviewUrl] = useState(null);   
  const [caption, setCaption] = useState("");          

  const plans = [
    {
      tier: 'BASIC',
      term: '1 Month',
      price: '10,500', 
      frequency: '/mo',
      popular: false,
      features: ['Instant Link', 'Unlimited Chats', '24/7 Support'],
    },
    {
      tier: 'GROWTH',
      term: '6 Months',
      price: '55,500', 
      frequency: '',
      popular: true,
      features: ['All Basic', 'Priority Routing', '24/7 Support'],
    },
    {
      tier: 'PROFESSIONAL',
      term: '1 Year',
      price: '120,000', 
      frequency: '',
      popular: false,
      features: ['All Growth', 'Voice Changer', 'Analytics'],
    },
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'seen':
        return <BsCheckAll className="text-blue-400" size={18} />;
      case 'delivered':
        return <BsCheckAll className="text-gray-400" size={18} />;
      default:
        return <BsCheck className="text-gray-400" size={16} />;
    }
  };

  const handleStartCall = async (targetUserId) => {
    if (!targetUserId || !agentData) return;
    peerConnectedRef.current = false; 
    setPeerConnected(false);
    const token = localStorage.getItem('agentToken');
    
    setIsEnding(true); 
    if (isTransitioningRef) isTransitioningRef.current = true;
    
    setCallStatus('ringing'); 
    setIsIncomingCall(false);
    setShowFullScreenCall(true); 
    
    if (callingAudio.current) {
      callingAudio.current.loop = true;
      callingAudio.current.play().catch(e => console.warn("Audio play blocked:", e));
    }

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
          voiceId: selectedVoiceId || "natural" 
        })
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || data.message || "Failed to initiate call");
      }

      const callMetadata = { 
        callId: data.callId || data.roomName, 
        roomName: data.roomName, 
        toId: targetUserId.toString(),
        fromId: agentData._id.toString()
      };

      setActiveCall(callMetadata);
      if (activeCallRef) activeCallRef.current = callMetadata;
      
      if (socket) {
        socket.emit("call-user", { 
          userToCall: targetUserId.toString(),
          fromId: agentData._id.toString(),
          fromName: `${agentData.firstName} ${agentData.lastName}`,
          photoUrl: agentData.photoUrl,
          roomName: data.roomName
        });
      }
      
      setLkToken(data.lkToken);
      console.log("✅ ZingConnect: Outbound call routing successfully. Poller active.");

      startStatusPolling(data.roomName);
      setIsEnding(false); 
      if (isTransitioningRef.current) isTransitioningRef.current = false;

    } catch (err) {
      console.error("❌ LiveKit Setup Error:", err);
      setIsEnding(false);
      if (isTransitioningRef) isTransitioningRef.current = false;

      if (callingAudio.current) {
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
      }
      alert(`Could not start call: ${err.message}`);
      handleEndCall();
    }
  };

  const startStatusPolling = (roomName) => {
    const startTime = Date.now(); 

    const pollInterval = setInterval(async () => {
      try {
        const token = localStorage.getItem('agentToken');
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${roomName}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });      
        const data = await res.json();
        const isTimeout = (Date.now() - startTime) > 45000; 
        
        if (data.success && (['ended', 'rejected', 'missed'].includes(data.status) || (isTimeout && data.status === 'calling'))) {
          console.log("🚫 Call timed out or changed state in remote polling engine.");
          clearInterval(pollInterval);
          handleEndCall(); 
        }
      } catch (err) {
        console.error("Poller Error:", err);
      }
    }, 4000); 
    
    if (pollingIntervalRef) pollingIntervalRef.current = pollInterval;
  };
const handleAcceptCall = async () => {
  if (ringtoneAudio.current) {
    ringtoneAudio.current.pause();
    ringtoneAudio.current.currentTime = 0;
  }
  
  const token = localStorage.getItem('agentToken');
  const callId = activeCall?.callId || activeCall?._id || activeCaller?.callId || activeCaller?._id;
  const remoteUserId = activeCaller?.fromId || activeCaller?.callerId || activeCall?.fromId || activeCall?.caller;

  if (!callId) {
    console.error("❌ ZingConnect Error: No Call ID found.");
    return;
  }

  try {
    setCallStatus('connecting'); 
    setShowFullScreenCall(true);
    
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || `Server Error: ${res.status}`);
    }
    
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      const tempCtx = new AudioContext();
      if (tempCtx.state === 'suspended') await tempCtx.resume();
    }
    
    const data = await res.json();
    if (data.success && data.lkToken) {
      if (callingAudio.current) {
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
      }
      
      setActiveCall(prev => ({ 
        ...prev,
        ...data.call, 
        callId: data.roomName || data.call?.roomName, 
        roomName: data.roomName || data.call?.roomName, 
        toId: remoteUserId,
        status: 'connected' 
      }));

      if (socket && remoteUserId) {
        socket.emit("accept-call", {
          to: remoteUserId.toString(),
          roomName: data.roomName,
          callId: callId
        });
      }
      setIsIncomingCall(true); 
      setLkToken(data.lkToken);
      console.log("📡 Core Token Applied. Handing connection off to LiveKit Room wrapper.");

    } else {
      throw new Error("No LiveKit token returned.");
    }

  } catch (err) {
    console.error("❌ ZingConnect Connection Failed:", err);
    setCallStatus('idle');
    handleEndCall(); 
  }
};

  const handleEndCall = useCallback(async () => {
    console.log("📴 ZingConnect: Initiating Safe Shutdown...");
    
    const myId = agentData?._id?.toString();
    const currentCall = activeCallRef.current || activeCall;
    const currentIncoming = activeCallerRef.current || activeCaller;
    
    const currentCallId = currentCall?.callId || 
                          currentCall?.roomName || 
                          currentCall?._id || 
                          currentIncoming?.callId;

    const potentialTargets = [
      currentCall?.toId,
      currentCall?.fromId,
      currentCall?.receiverId,
      currentCall?.callerId,
      currentIncoming?.fromId,
      currentIncoming?.callerData?.callerId
    ];

    const targetId = potentialTargets.find(id => {
      if (!id) return false;
      const cid = id._id ? id._id.toString() : id.toString();
      return cid !== myId;
    });

    [pollingIntervalRef, pollingRef].forEach(ref => {
      if (ref?.current) {
        clearInterval(ref.current);
        ref.current = null;
      }
    });

    if (socket && targetId) {
      const finalTarget = String(targetId).trim();
      console.log(`📡 Signaling END to Remote Party: ${finalTarget}`);
      socket.emit("end-call", { to: finalTarget, callId: currentCallId });
      socket.emit("call-ended", { to: finalTarget, callId: currentCallId });
    } else {
      console.warn("⚠️ Pipeline Warn: Direct clean execution down pathway without peer connection metadata.");
    }

    [ringtoneAudio, callingAudio, notificationSound].forEach(ref => {
      if (ref?.current) {
        ref.current.pause();
        ref.current.currentTime = 0;
      }
    });
    
    setCallStatus('idle');
    setLkToken(null);
    setActiveCall(null);
    setActiveCaller(null);
    setIsIncomingCall(false);
    setShowFullScreenCall(false);
    setCallTime(0);
    setPeerConnected(false);
    
    if (activeCallRef) activeCallRef.current = null;
    if (activeCallerRef) activeCallerRef.current = null;
    
    const token = localStorage.getItem('agentToken');
    if (currentCallId && token) {
      fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ callId: currentCallId }) 
      }).catch(e => console.error("❌ DB Sync Error:", e));
    }
  }, [agentData, activeCall, activeCaller, socket]);

  const handleRejectCall = async () => {
    console.log("🚫 Agent rejecting incoming call...");
    const targetId = activeCaller?.fromId || activeCall?.caller || activeCall?.fromId;
    const callId = activeCaller?.callId || activeCall?._id;

    if (socket && targetId) {
      socket.emit("end-call", { 
        to: String(targetId).trim(), 
        reason: 'rejected',
        callId 
      });
    }
    
    handleEndCall(); 
  };

  const startHold = (id) => {
    const timer = setTimeout(() => {
      if (window.confirm("Delete this message?")) {
        handleDeleteMessage(id);
      }
    }, 700); 
    setHoldTimer(timer);
  };

  const stopHold = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      setHoldTimer(null);
    }
  };

  // FIXED: Leverages LiveKit's unified tracks wrapper loop safely 
  const startVoiceConversion = async (livekitMediaStream) => {
    let aiStream = null; 
    
    try {
      const sourceStream = livekitMediaStream || userStreamRef.current;
      if (!sourceStream) return null;
      
      aiStream = new MediaStream(sourceStream.getAudioTracks().map(t => t.clone()));    
      sourceStream.getAudioTracks().forEach(track => { track.enabled = false; });

      socket.emit("start-voice-conversion", { 
        voiceId: selectedVoiceId || activeCall?.voiceId,
        agentId: agentData._id,
        targetId: activeCall?.toId || activeCall?.fromId 
      });

      setIsVoiceConversionActive(true);

      const mediaRecorder = new MediaRecorder(aiStream, { mimeType: 'audio/webm;codecs=opus' });
      aiMediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket) {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            socket.emit("agent-audio-stream", base64);
          };
          reader.readAsDataURL(event.data);
        }
      };

      mediaRecorder.start(100); 
      console.log("🚀 AI Voice Bridge Active");
      
    } catch (err) {
      console.error("Failed to start voice conversion:", err);
      setIsVoiceConversionActive(false);
      return null; 
    }
    
    return aiStream;
  };

  const stopVoiceConversion = () => {
    if (aiMediaRecorderRef.current) {
      if (aiMediaRecorderRef.current.state !== "inactive") aiMediaRecorderRef.current.stop();
      aiMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      aiMediaRecorderRef.current = null;
    }

    if (userStreamRef.current) {
      userStreamRef.current.getAudioTracks().forEach(track => { track.enabled = true; });
    }

    socket.emit("stop-voice-conversion", { callId: activeCall?.callId || activeCall?._id });
    setIsVoiceConversionActive(false);
  };

  /* --- INTERNAL AUDIO CONTROLLER SUBCOMPONENTS (SAFE FROM ROOMEEVENT MISSES) --- */
  const LocalUserMuteController = ({ isMuted, isMasked }) => {
    const { localParticipant } = useLocalParticipant();
    const room = useRoomContext();

    useEffect(() => {
      if (!localParticipant || !room) return;
      
      const syncMic = async () => {
        if (room.state !== 'connected') {
          console.log(`⏳ LiveKit Engine is ${room.state} - Stalling mic track synchronization...`);
          return;
        }
        
        const shouldPublish = !isMasked && !isMuted;
        try {
          await localParticipant.setMicrophoneEnabled(shouldPublish);
          console.log(`🎙️ Agent Mic Sync: ${shouldPublish ? 'ON' : 'OFF (Masked/Muted)'}`);
        } catch (err) {
          console.error("❌ Agent Mic Sync Error:", err);
        }
      };

      syncMic();

      const handleStateChange = () => {
        if (room.state === 'connected') syncMic();
      };

      // FIXED: Swapped out undefined RoomEvent tracking references for robust string literal events
      room.on('connectionStateChanged', handleStateChange);
      return () => {
        room.off('connectionStateChanged', handleStateChange);
      };
    }, [isMuted, isMasked, localParticipant, room]);

    return null;
  };

  const AudioSession = ({ 
  isMuted, 
  isMasked, 
  isIncomingCall, 
  setCallStatus, 
  setPeerConnected, 
  ringtoneAudio, 
  callingAudio 
}) => {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const handleConnectionEngineState = async () => {
      console.log(`📡 ZingConnect Room Context State Changed: ${room.state}`);
      
      if (room.state === 'connected') {
        console.log("⚡ ZingConnect: Audio Bridge Fully Established via Context.");
        
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) {
            const ctx = new AudioContext();
            if (ctx.state === 'suspended') await ctx.resume();
          }
        } catch (e) { 
          console.error("Audio Context Wake-up failed", e); 
        }

        if (isIncomingCall) {
          console.log("📥 Inbound call verified. Transitioning view to connected call.");
          if (ringtoneAudio.current) {
            ringtoneAudio.current.pause();
            ringtoneAudio.current.currentTime = 0;
          }
          setCallStatus('connected');
          setPeerConnected(true);
        } else {
          const hasRemoteAudio = Array.from(room.remoteParticipants.values()).some(p => p.isMicrophoneEnabled);
          if (hasRemoteAudio) {
            handleRemotePartyConnected();
          } else {
            console.log("🔒 Outgoing channel ready. Ringing active. Awaiting user track publication...");
          }
        }
      }
    };
    const handleRemotePartyConnected = () => {
      console.log("🔒 ZingConnect Handshake Verified: Remote audio track captured.");
      if (callingAudio.current) {
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
      }
      setCallStatus('connected');
      setPeerConnected(true);
    };

    room.on('connectionStateChanged', handleConnectionEngineState);
    room.on('trackSubscribed', handleRemotePartyConnected);

    if (room.state === 'connected') {
      handleConnectionEngineState();
    }

    return () => {
      room.off('connectionStateChanged', handleConnectionEngineState);
      room.off('trackSubscribed', handleRemotePartyConnected);
    };
  }, [room, isIncomingCall, setCallStatus, setPeerConnected, ringtoneAudio, callingAudio]);

  return (
    <>
      <LocalUserMuteController isMuted={isMuted} isMasked={isMasked} />
      <RoomAudioRenderer />
    </>
  );
};

  /* --- GLOBALLY BOUND ASYNC EFFECT LIFECYCLES --- */
  useEffect(() => {
    socket.on("voice-state-updated", (data) => {
      if (data.mode === 'natural') {
        if (userStreamRef.current) {
          userStreamRef.current.getAudioTracks().forEach(track => {
            track.enabled = true;
          });
        }
        setIsVoiceConversionActive(false);
      }
    });

    return () => {
      socket.off("voice-state-updated");
    };
  }, []);

  useEffect(() => {
    const isNatural = !selectedVoiceId || selectedVoiceId === "natural";
    if (!userStreamRef.current) return;
    const tracks = userStreamRef.current.getAudioTracks();
    if (isVoiceConversionActive && !isNatural) {
      tracks.forEach(track => {
        if (track.enabled) track.enabled = false;
      });
      console.log("🔇 Local tracks disabled: AI Masking Active");
    } else {
      tracks.forEach(track => {
        if (!track.enabled) track.enabled = true;
      });
      console.log("🔊 Local tracks enabled: Natural Mode");
    }
  }, [isVoiceConversionActive, selectedVoiceId]);

useEffect(() => {
  const currentCallId = activeCall?.roomName || activeCall?.callId;
  if (!socket || !currentCallId) return;
  const token = localStorage.getItem('agentToken');
 const onCallAccepted = (data) => {
  console.log("🔊 User picked up. Switching Agent to connected mode.");
    peerConnectedRef.current = true; 
  if (callingAudio.current) {
    callingAudio.current.pause();
    callingAudio.current.currentTime = 0;
  }
  if (pollingIntervalRef.current) {
    clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = null;
  }
  setCallStatus('connected');
  setPeerConnected(true);
  if (data?.roomName || data?.callId) {
    setActiveCall(prev => ({
      ...prev,
      callId: data.callId || prev.callId,
      roomName: data.roomName || prev.roomName
    }));
  }
};
  socket.on("call-accepted", onCallAccepted);
  socket.on("answer-call", onCallAccepted);
  const fallbackCheck = setInterval(async () => {
    if (callStatus === 'calling' && !peerConnected) {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${currentCallId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.status === 'connected') {
          console.log("📡 Fallback: DB verified connection.");
          onCallAccepted(data); 
          clearInterval(fallbackCheck);
        }
      } catch (err) { /* Jitter */ }
    } else {
      clearInterval(fallbackCheck);
    }
  }, 1000); // 1s is sharper than 2s

  return () => {
    socket.off("call-accepted", onCallAccepted);
    socket.off("answer-call", onCallAccepted);
    clearInterval(fallbackCheck);
  };}, [socket, activeCall?.roomName, activeCall?.callId]);

  // THIS IS THE MISSING LINK
useEffect(() => {
  if (lkToken && peerConnected && callStatus === 'calling') {
    console.log("🔓 Handshake complete: Moving UI to Connected state.");
    setCallStatus('connected');
    
    if (callingAudio.current) {
      callingAudio.current.pause();
      callingAudio.current.currentTime = 0;
    }
  }
}, [peerConnected, lkToken, callStatus]);

useEffect(() => {
  if (!socket) return;
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let nextStartTime = 0; // Tracks when the next chunk should play to avoid gaps
  const handleAiAudioChunk = async (base64Audio) => {
    if (callStatus !== 'connected' && callStatus !== 'connecting') return;
    try {
      const binaryString = window.atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = isSpeakerOn ? 1.0 : 0.6;
      gainNode.connect(audioCtx.destination);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      const currentTime = audioCtx.currentTime;
      if (nextStartTime < currentTime) {
        nextStartTime = currentTime;
      }

      source.start(nextStartTime);
      nextStartTime += audioBuffer.duration;

    } catch (err) {
      console.error("AI Audio Streaming Error:", err);
    }
  };

  socket.on("ai-audio-chunk", handleAiAudioChunk);
  
  return () => {
    socket.off("ai-audio-chunk", handleAiAudioChunk);
    if (audioCtx.state !== 'closed') {
      audioCtx.close();
    }
  };
}, [socket, callStatus, isSpeakerOn]);
const unlockAudio = () => {
  setAudioUnlocked(true);
  console.log("Initializing secure audio channels for Agent...");
  
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    const tempCtx = new AudioContext();
    if (tempCtx.state === 'suspended') tempCtx.resume();
  }

  // 🚀 FIX: Append unique cache-busting keys so the Service Worker drops cache control
  const cacheBuster = `?t=${Date.now()}`;
  const audioRefs = [
    { ref: ringtoneAudio, src: `/sounds/ringtone.mp3${cacheBuster}` },
    { ref: callingAudio, src: `/sounds/calling.wav${cacheBuster}` },
    { ref: notificationSound, src: `/sounds/notification.mp3${cacheBuster}` }
  ];

  audioRefs.forEach(({ ref, src }) => {
    const el = ref.current;
    if (el) {
      el.muted = true;
      el.crossOrigin = "anonymous"; 
      el.src = src;
      el.load(); 
      el.play().then(() => {
        el.pause();
        el.muted = false; // Now it is unblocked and ready for real calls
        el.currentTime = 0;
      }).catch(err => console.warn(`Priming skipped for ${src}`, err.message));
    }
  });

  let remoteAudio = document.getElementById('remoteAudio');
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio');
    remoteAudio.id = 'remoteAudio';
    remoteAudio.setAttribute('playsinline', 'true');
    remoteAudio.style.display = 'none';
    document.body.appendChild(remoteAudio);
  }
  
  remoteAudio.play().then(() => remoteAudio.pause()).catch(() => {});
  
  if (socket && agentData?._id) {
    socket.emit("join-private-room", agentData._id);
  }

  document.removeEventListener('click', unlockAudio);
  document.removeEventListener('touchstart', unlockAudio);
};

useEffect(() => {
  if (localAudioRef.current && localStream) {
    localAudioRef.current.srcObject = localStream;
    console.log("⚓ Local stream anchored to muted audio element");
  }
}, [localStream]);

useEffect(() => {
  if (!socket) return;
  
  const handleStatusUpdate = ({ userId, isOnline, lastSeen }) => {
    setUsers(prevUsers => prevUsers.map(u => 
      u._id === userId ? { ...u, isOnline, lastSeen } : u
    ));
        setSelectedUser(prev => {
      if (prev?._id === userId) {
        return { ...prev, isOnline, lastSeen };
      }
      return prev;
    });
  };
  socket.on('user_status_update', handleStatusUpdate);
  return () => {
    socket.off('user_status_update', handleStatusUpdate);
  };
}, [socket]); // Only depend on socket

useEffect(() => {
  let timer;

  if (callStatus === 'connected') {
    setCallTime(0);
    const localStart = Date.now();
    
    timer = setInterval(() => {
      const now = Date.now();
      const secondsPassed = Math.floor((now - localStart) / 1000);
            setCallTime(secondsPassed > 0 ? secondsPassed : 0);
    }, 1000);

    console.log("⏱️ Call Timer started locally.");
  } else {
    setCallTime(0);
  }
  return () => {
    if (timer) {
      clearInterval(timer);
      console.log("⏱️ Call Timer cleared.");
    }
  };
}, [callStatus]); 

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

useEffect(() => {
  if (!socket || !agentData?._id) return;
  const myRoomId = agentData._id.toString();
  socket.emit("join-main-room", myRoomId);
  const handleRemoteEnd = (data) => {
    console.log("📥 Received remote end signal:", data);
        const currentCallId = (activeCall?.callId || activeCall?._id || activeCaller?.callId || "").toString();
    const incomingCallId = (data?.callId || "").toString();
        if (incomingCallId && currentCallId && incomingCallId !== currentCallId) {
      console.warn("⚠️ Ignored end-signal for different callId");
      return;
    }
    if (typeof setIsVoiceConversionActive === 'function') setIsVoiceConversionActive(false);
    if (typeof setIsMuted === 'function') setIsMuted(false); 

    handleEndCall(); 
  };

  const onIncoming = async (data) => {
    peerConnectedRef.current = false; 
    setPeerConnected(false);
    if (callStatus !== 'idle') {
      socket.emit("user-busy", { to: data.fromId, callId: data.callId || data._id });
      return;
    }

    const callId = data.callId || data._id;
    const token = localStorage.getItem('agentToken'); 

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${callId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const statusData = await res.json();
      
      if (statusData && ['ended', 'missed', 'rejected', 'declined'].includes(statusData.status)) {
        console.log("⏭️ Incoming call already finalized in DB.");
        return;
      }

      socket.emit("confirm-ringing", { to: data.fromId });

      setActiveCaller({
        fromName: data.fromName,
        photoUrl: data.photoUrl,
        fromId: data.fromId,
        callId: callId
      });

      setActiveCall({ 
        callId: callId, 
        fromId: data.fromId,
        voiceId: data.voiceId 
      });

      setIsIncomingCall(true);
      setCallStatus('ringing');
    } catch (err) {
      console.error("Agent side check failed:", err);
    }
  };

  const onUserRinging = () => {
    setCallStatus(prev => (prev === 'calling' ? 'ringing' : prev));
  };

  const onCallAccepted = () => {
    console.log("🔊 User picked up. Silencing outgoing tones.");
    if (callingAudio.current) {
      callingAudio.current.pause();
      callingAudio.current.currentTime = 0;
    }
    setCallStatus('connected');
    setPeerConnected(true);
  };

  // 4. Attach Listeners
  socket.on("incoming-call", onIncoming);
  socket.on("user-is-ringing", onUserRinging);
  socket.on("call-accepted", onCallAccepted);
  socket.on("call-ended", handleRemoteEnd);
  socket.on("end-call", handleRemoteEnd);
  socket.on("call-rejected", handleRemoteEnd);

  // 5. Cleanup on Unmount
  return () => {
    socket.off("incoming-call", onIncoming);
    socket.off("user-is-ringing", onUserRinging);
    socket.off("call-accepted", onCallAccepted);
    socket.off("call-ended", handleRemoteEnd);
    socket.off("end-call", handleRemoteEnd);
    socket.off("call-rejected", handleRemoteEnd);
  };
}, [
  agentData?._id, 
  socket, 
  handleEndCall, 
  callStatus, // Add this
  activeCall, // Add this
  activeCaller // Add this
]);

useEffect(() => {
  const token = localStorage.getItem('agentToken');
    if (!token || !agentData?._id || callStatus !== 'idle') {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    return;
  }
  const pollForCalls = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/check-incoming`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.hasIncomingCall && callStatus === 'idle') {
        const { callerData, callId } = data;
        const rawPath = callerData?.photoUrl;
        const absolutePhotoUrl = rawPath?.startsWith('http') 
          ? rawPath 
          : `${import.meta.env.VITE_API_URL}/${rawPath?.replace(/^\//, '') || 'default-avatar.png'}`;
        setActiveCaller({
          fromName: callerData?.fromName || "Incoming Call",
          photoUrl: absolutePhotoUrl,
          fromId: callerData?.callerId,
          callId: callId
        });
        setActiveCall({ 
          callId: callId, 
          fromId: callerData?.callerId 
        });
        setIsIncomingCall(true);
        setCallStatus('ringing');
      }
    } catch (err) {
      console.warn("Polling check jitter:", err);
    }
  };
  pollingIntervalRef.current = setInterval(pollForCalls, 4000);
  return () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
  };
}, [agentData?._id, callStatus]); // Triggers poll only when status returns to 'idle'

useEffect(() => {
  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      console.log("📱 ZingConnect: App returned to foreground.");
      if (callStatus !== 'idle') {
        console.log("📞 Call active. Skipping re-sync to maintain connection.");
        return; 
      }

      if (socket) {
        if (agentData?._id) {
          socket.emit("join-main-room", agentData._id.toString());
        }
        if (!socket.connected) socket.connect();
      }

      if (selectedUser?._id) {
        const token = localStorage.getItem('agentToken');
        try {
          const response = await fetch(`/api/messages/${selectedUser._id}?limit=30`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await response.json();
          if (data.success) setMessages(data.messages);
        } catch (err) {
          console.warn("Message catch-up failed:", err);
        }
      }
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}, [agentData?._id, selectedUser?._id, callStatus]);


useEffect(() => {
  const token = localStorage.getItem('agentToken') || localStorage.getItem('userToken');
  const currentCallId = activeCall?.roomName || activeCall?.callId || activeCall?._id;

  if (!token || !currentCallId || typeof currentCallId !== 'string' || callStatus === 'idle') {
    return;
  }
  const syncStatus = async () => {
    if (!['calling', 'ringing', 'connecting', 'connected'].includes(callStatus)) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${currentCallId}`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        }
      });
      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType?.includes("application/json")) {
        if (res.status === 404) handleEndCall();
        return;
      }
      const data = await res.json();
      if (data?.status === 'ringing' && callStatus === 'calling') {
        setCallStatus('ringing');
      }
            if (data?.status === 'connected' && callStatus !== 'connected') {
        if (isIncomingCall) {
          setCallStatus('connected');
          setPeerConnected(true);
        } else {
          console.log("📡 DB is connected, but Agent is dialing out. Awaiting explicit user socket acceptance...");
        }
      }

      if (data && ['ended', 'declined', 'missed', 'rejected'].includes(data.status)) {
        handleEndCall();
      }
    } catch (e) {
      console.warn("ZingConnect Sync Jitter:", e.message);
    }
  };
  const interval = setInterval(syncStatus, 3000);
  return () => clearInterval(interval);
}, [callStatus, activeCall?.roomName, activeCall?.callId, activeCall?._id, handleEndCall, isIncomingCall]); 

useEffect(() => {
  if (!socket) return;

  const handleAnswer = (data) => {
    const currentCallId = activeCall?.callId || activeCall?._id;
    if (data.callId && currentCallId && data.callId.toString() !== currentCallId.toString()) return;

    console.log("⚡ Instant Socket Answer Received!");
    if (connectionRef.current && data.signal) {
      const parsed = typeof data.signal === 'string' ? JSON.parse(data.signal) : data.signal;
      
      // If peer is already stable/connected, don't signal again
      if (!connectionRef.current.connected) {
        connectionRef.current.signal(parsed);
        setCallStatus('connecting');
      }
    }
  };

  socket.on("call-accepted", handleAnswer);
  socket.on("answer-call", handleAnswer); // Handle both event names just in case

  return () => {
    socket.off("call-accepted", handleAnswer);
    socket.off("answer-call", handleAnswer);
  };
}, [socket, activeCall?.callId, activeCall?._id]);

useEffect(() => {
  const container = scrollRef.current;
  if (!container) return;
  const threshold = 200; 
  const isNearBottom = 
    container.scrollHeight - container.scrollTop <= container.clientHeight + threshold;
  if (isNearBottom || isUploading) {
    const timeoutId = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ 
        behavior: isUploading ? "auto" : "smooth", 
        block: "end" 
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }
}, [messages, isUploading]);

useEffect(() => {
  const ringtone = ringtoneAudio.current;
  if (!ringtone) return;

  if (callStatus === 'ringing' && isIncomingCall) {
    ringtone.loop = true;
    ringtone.play().catch(err => console.log("Audio blocked", err));
  } 
  else if (callStatus === 'calling') {
  }
  else {
    ringtone.pause();
    ringtone.currentTime = 0;
  }
}, [callStatus, isIncomingCall]);

useEffect(() => {
  return () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      console.log("Memory Cleaned: Preview URL revoked.");
    }
  };
}, [previewUrl]);

useEffect(() => {
  if (!socket) return;
const handleRemoteEnd = (data) => {
  const currentCallId = (activeCall?.callId || activeCall?._id || activeCaller?.callId || "").toString();
  const incomingCallId = (data?.callId || "").toString();
  
  if (incomingCallId && currentCallId && incomingCallId !== currentCallId) return;
  if (data.reason === 'missed') {
     console.log("User did not pick up in time.");
  }

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
}, [socket, activeCall?.callId, activeCall?._id, activeCaller?.callId]);



useEffect(() => {
  if (isVoiceConversionActive) return;
  if (agentData?.voiceId) {
    setSelectedVoiceId(agentData.voiceId);
    console.log("📡 Voice Identity Synced to Dashboard:", agentData.voiceId);
  } else {
    setSelectedVoiceId("");
  }
}, [agentData, isVoiceConversionActive]);


useEffect(() => {
  const handleOnline = () => setConnectionStatus('connected');
  const handleOffline = () => setConnectionStatus('offline');

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, []);

 // 1. Modified Heartbeat with Dual Login detection
useEffect(() => {
  const heartBeat = setInterval(async () => {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

    try {
      const response = await fetch('/api/agents/heartbeat', { 
        method: 'POST', 
        headers: { 'Authorization': `Bearer ${token}` } 
      });

      // If heartbeat detects a new session elsewhere
      if (response.status === 403) {
        const data = await response.json();
        if (data.reason === 'dual_login') {
          setIsDualLoginConflict(true); // Triggers the Red/Black Security Alert
          clearInterval(heartBeat); // Stop polling once conflict is found
        }
      }
    } catch (err) {
      console.error("Heartbeat sync failed");
    }
  }, 60000); 

  return () => clearInterval(heartBeat);
}, []);

useEffect(() => {
  // 1. Flutterwave Script Injection (Anti-Duplicate Logic)
  const existingScript = document.querySelector('script[src*="flutterwave"]');
  let script;

  if (!existingScript) {
    script = document.createElement('script');
    script.src = "https://checkout.flutterwave.com/v3.js";
    script.async = true;
    document.body.appendChild(script);
  }

  // 2. Data Initialization Logic
  const fetchInitialData = async () => {
    const token = localStorage.getItem('agentToken');
    if (!token) return navigate('/');

    try {
      const profileRes = await fetch('/api/agents/profile/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // Handle Authentication Errors
      if (profileRes.status === 401) {
        localStorage.removeItem('agentToken');
        return navigate('/');
      }

      // Handle Dual Login Security
      if (profileRes.status === 403) {
        const errorData = await profileRes.json();
        if (errorData.reason === 'dual_login') {
          setIsDualLoginConflict(true);
          setLoading(false);
          return;
        }
      }
      if (!profileRes.ok) throw new Error("Failed to load profile");
      const profileData = await profileRes.json();
      const agent = profileData.agent;
      if (agent) {
        setAgentData(agent);
        const activeStatus = !!agent.isSubscribed;
        setIsSubscribed(activeStatus);

        if (agent.plan) setSelectedPlan(agent.plan);

        // 3. Conditional Data Loading (Only for active subscribers)
        if (activeStatus) {
          const usersRes = await fetch('/api/agents/my-users', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const userData = await usersRes.json();
          if (userData.success && Array.isArray(userData.users)) {
            setUsers(userData.users);
          }
        }
      }
    } catch (err) {
      console.error("Initialization error:", err);
    } finally {
      setLoading(false);
    }
  };
  fetchInitialData();
  return () => {
    if (script && document.body.contains(script)) {
      document.body.removeChild(script);
    }
  };
}, [navigate]);

  const handlePayment = async () => {
  if (!agentData || !agentData.email) {
    alert("Profile data is still loading. Please wait a moment or refresh.");
    return;
  }
  setPaymentProcessing(true);
  const token = localStorage.getItem('agentToken');
  const activePlan = plans.find(p => p.tier === selectedPlan);

  if (!activePlan) {
    alert("Invalid plan selected");
    setPaymentProcessing(false);
    return;
  }

  try {
    const finalNairaAmount = Number(activePlan.price.replace(/,/g, ''));

    window.FlutterwaveCheckout({
      public_key: import.meta.env.VITE_FLW_PUBLIC_KEY,
      tx_ref: `ZING-${Date.now()}`,
      amount: finalNairaAmount,
      currency: "NGN",
      payment_options: "card, account, transfer, ussd",
      customer: {
        email: agentData?.email,
        name: `${agentData?.firstName} ${agentData?.lastName}`,
        phone_number: agentData?.phone, // Optional: added phone since we now collect it
      },
      customizations: {
        title: "ZingConnect",
        description: `Activation for ${activePlan.tier} Plan (₦${activePlan.price})`,
        logo: "https://cdn-icons-png.flaticon.com/512/9431/9431166.png",
      },
      callback: async (response) => {
        try {
          const verifyRes = await fetch('/api/subscriptions/verify', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              transaction_id: response.transaction_id,
              plan: activePlan.tier,
              ngnAmount: finalNairaAmount // Changed from usdAmount to ngnAmount
            })
          });

          if (verifyRes.ok) {
            setShowSuccessOverlay(true);
            setTimeout(() => {
              window.location.reload(); 
            }, 4000);
          } else {
            const errData = await verifyRes.json();
            alert(errData.message || "Verification failed");
          }
        } catch (err) {
          console.error("Verification error:", err);
          alert("Connection error during verification.");
        } finally {
          setPaymentProcessing(false);
        }
      },
      onclose: () => {
        setPaymentProcessing(false);
      }
    });
  } catch (err) {
    console.error("Payment Initialization Error:", err);
    alert("Failed to initialize payment.");
    setPaymentProcessing(false);
  }
};

const handleFileUpload = (e) => {
  const file = e.target.files[0];
  if (!file || !selectedUser) return;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  const detectedType = isVideo ? 'video' : 'image';

  if (!isVideo && !isImage) {
    alert("Please upload only images or videos.");
    return;
  }

  const maxLimit = 100 * 1024 * 1024; 
  if (file.size > maxLimit) {
    alert(`This ${detectedType} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum allowed is 100MB.`);
    e.target.value = null; 
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

 const objectUrl = URL.createObjectURL(file);
  setPreviewFile(file);
  setPreviewUrl(objectUrl);
  setCaption("");

  if (e.target) e.target.value = null; 
};

const handleDownload = async (fileUrl, detectedType) => {
  try {
    const response = await fetch(fileUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const timestamp = new Date().getTime();
    const extension = detectedType === 'video' ? 'mp4' : 'jpg';
    const fileName = `Zing_Secure_${timestamp}.${extension}`;

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Download failed:", error);
  }
};

const handleDeleteMessage = async (msgId) => {
  const token = localStorage.getItem('agentToken');
    const originalMessages = [...messages];
  setMessages(prev => prev.filter(m => (m._id || m.id) !== msgId));

  try {
    const res = await fetch(`/api/messages/${msgId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
      setMessages(originalMessages);
      alert("Failed to delete message from server.");
    }
  } catch (err) {
    setMessages(originalMessages);
    console.error("Delete request failed:", err);
  }
};

const handleFinalSend = async () => {
  if (!previewFile || isUploading || !selectedUser) return;
  setIsUploading(true);

  try {
    const token = localStorage.getItem('agentToken');
    const detectedType = previewFile.type.startsWith('video/') ? 'video' : 'image';
    
    // 1. Get Signed URL
    const urlResponse = await fetch('/api/messages/get-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ fileName: previewFile.name, fileType: previewFile.type })
    });
    const { uploadUrl, key } = await urlResponse.json();

    // 2. Upload directly to S3/Cloud Storage
    const directUpload = await fetch(uploadUrl, {
      method: 'PUT',
      body: previewFile,
      headers: { 'Content-Type': previewFile.type }
    });

    if (!directUpload.ok) throw new Error("Cloud upload failed");

    // 3. Confirm to DB
    const confirmResponse = await fetch('/api/messages/confirm-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        receiverId: selectedUser._id,
        text: caption,
        fileUrl: key,
        fileType: detectedType
      })
    });

    const finalData = await confirmResponse.json();
    if (finalData.success) {
      setMessages(prev => [...prev, finalData.message]);
      // Cleanup
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewFile(null);
      setCaption("");
    }
  } catch (err) {
    alert("Upload failed. Please check your connection.");
  } finally {
    setIsUploading(false);
  }
};

  const handleLogout = () => {
    const currentSlug = agentData.slug;
    localStorage.removeItem('agentToken');
    if (currentSlug) {
      window.location.href = `/${currentSlug}`;
    } else {
      window.location.href = '/';
    }
  };
  const handleSelectUser = async (user) => {
  if (window.innerWidth < 1024) setShowSidebar(false);
  
  // 1. Prepare the UI for a fresh jump
  setMessages([]); 
  setIsInitialLoad(true); // <--- CRITICAL: Reset this so the scroll logic triggers
  setSelectedUser(user);
  setLimit(30);
  if (socket) socket.emit('join-chat', user._id); 

  try {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

    const response = await fetch(`/api/messages/${user._id}?limit=30`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      setConnectionStatus('connected');
      const data = await response.json();
      
      if (data.success && Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
            fetch(`/api/messages/mark-read/${user._id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(err => console.error("Mark read background error:", err));
      
    } else {
      setConnectionStatus('connecting');
    }
  } catch (err) {
    setConnectionStatus('connecting');
    console.error("Failed to load chat history:", err);
  }
};

// Add this inside the AgentDashboard component
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const userIdFromUrl = params.get('userId');
  
  if (userIdFromUrl && users.length > 0) {
    const userToSelect = users.find(u => u._id === userIdFromUrl);
    if (userToSelect) {
      handleSelectUser(userToSelect);
      // Clean the URL so refreshing doesn't keep resetting the chat
      navigate('/agent/dashboard', { replace: true });
    }
  }
}, [users, navigate]); // Fires as soon as the user list is loaded from the API


useEffect(() => {
  setIsInitialLoad(true);
}, [selectedUser?._id]);

useEffect(() => {
  const container = scrollRef.current;
  if (!container || messages.length === 0) return;

  if (isInitialLoad) {
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      const timeoutId = setTimeout(() => {
        container.scrollTop = container.scrollHeight;
        setIsInitialLoad(false); 
      }, 150); // 150ms is the "sweet spot" for mobile layout stability

      return () => clearTimeout(timeoutId);
    });
  } else {
    const threshold = 150;
    const isNearBottom = 
      container.scrollHeight - container.scrollTop <= container.clientHeight + threshold;

    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }
}, [messages, isInitialLoad]);

useEffect(() => {
  if (!isSubscribed || !agentData?._id) return;

  const refreshData = async () => {
    // Don't poll if we are busy in a call
    if (['calling', 'ringing', 'connecting', 'connected'].includes(callStatus)) return;
    
    const token = localStorage.getItem('agentToken');
    try {
      const userRes = await fetch('/api/agents/my-users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const userData = await userRes.json();
      if (userData.success) setUsers(userData.users);
      if (selectedUser?._id && document.visibilityState === 'visible') {
        const msgRes = await fetch(`/api/messages/${selectedUser._id}?limit=30`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const msgData = await msgRes.json();
        
        if (msgData.success && Array.isArray(msgData.messages)) {
          const incomingMsgs = msgData.messages;
          const targetLatestMsg = incomingMsgs[incomingMsgs.length - 1];
          if (targetLatestMsg && targetLatestMsg.senderModel === 'User' && targetLatestMsg._id !== lastNotifiedId.current) {
            lastNotifiedId.current = targetLatestMsg._id;
            
            if (notificationSound.current) {
              notificationSound.current.currentTime = 0;
              notificationSound.current.play().catch(() => {});
            }
          }

          setMessages(prev => {
            const isNew = incomingMsgs.length !== prev.length || 
                          (incomingMsgs[0]?._id !== prev[0]?._id) ||
                          (incomingMsgs[incomingMsgs.length - 1]?._id !== prev[prev.length - 1]?._id);
            return isNew ? incomingMsgs : prev;
          });
        }
      }
    } catch (err) { console.warn("Refresh jitter fallback skipped"); }
  };

  const interval = setInterval(refreshData, 5000);
  return () => clearInterval(interval);
}, [isSubscribed, selectedUser?._id, callStatus]);

useEffect(() => {
  const setupNotifications = async () => {
    try {
      const publicKey = import.meta.env.VITE_PUBLIC_KEY;
      if (!publicKey) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      
      // Get existing or new
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      // We use agentToken here because that is what your AgentDashboard uses
      const token = localStorage.getItem('agentToken');
      if (!token) return;

      // Sync with backend
      await fetch('/api/save-subscription', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ subscription }) 
      });
      
      console.log("Agent Mobile Push Synced to DB");
    } catch (err) {
      console.error("Agent Push setup failed:", err);
    }
  };
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    setupNotifications();
  }
}, []);

useEffect(() => {
  const applyTheme = () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };
  applyTheme();
  window.addEventListener('storage', applyTheme);
  return () => window.removeEventListener('storage', applyTheme);
}, []);

useEffect(() => {
  if (!socket) return;
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  const handleIncomingMessage = (data) => {
    console.log("📥 Real-time Socket Message Detected:", data);

    // 1. Core Safeguard: Drop duplicates by tracking message ID explicitly
    if (data._id && data._id === lastNotifiedId.current) return;
    lastNotifiedId.current = data._id;

    const isChattingWithSender = selectedUser && (data.senderId === selectedUser._id || data.senderId === selectedUser.id);
    
    if (isChattingWithSender) {
      setMessages((prev) => {
        if (prev.some(m => m._id === data._id)) return prev;
        return [...prev, data];
      });

      // Mark as read immediately on backend
      const token = localStorage.getItem('agentToken');
      fetch(`/api/messages/mark-read/${selectedUser._id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(err => console.error("Mark read error:", err));
    }
    if (data.senderModel === 'User') {
      if (notificationSound.current) {
        notificationSound.current.currentTime = 0;
        notificationSound.current.play().catch((err) => 
          console.warn("🔊 Notification audio context autoplay restricted:", err.message)
        );
      }
      
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]); // Double pulse haptic alert
      }
      const shouldShowPopup = document.visibilityState !== 'visible' || !isChattingWithSender;
      if (Notification.permission === "granted" && shouldShowPopup) {
        const popup = new Notification(`Message from ${data.senderName || 'Client'}`, {
          body: data.text || "Sent a file",
          icon: data.senderPhoto || '/favicon.ico',
          tag: 'zing-msg',
          renotify: true
        });
        popup.onclick = () => { 
          window.focus(); 
          popup.close(); 
        };
      }
    }
  };

  socket.on('new-message', handleIncomingMessage);
  return () => {
    socket.off('new-message', handleIncomingMessage);
  };
}, [socket, selectedUser]); 

useEffect(() => {
  if (!("Notification" in window)) {
    console.log("This browser does not support desktop notifications");
  } else if (Notification.permission !== "granted") {
    Notification.requestPermission();
  }
}, []);

const handleResend = async (failedMsg) => {
  setMessages(prev => prev.filter(m => (m._id || m.id) !== (failedMsg._id || failedMsg.id)));
    if (failedMsg.fileUrl) {
    setPreviewFile(failedMsg.file); // Assuming you saved the file object
    setPreviewUrl(failedMsg.fileUrl);
    setCaption(failedMsg.text);
  } else {
    setNewMessage(failedMsg.text);
  }
};

const handleSendMessage = async (e) => {
  e.preventDefault();
  
  // 1. Basic validation
  if (!newMessage.trim() || !selectedUser || isUploading) return;

  const textToSend = newMessage;
  const tempId = Date.now().toString(); // Temporary ID for the UI key
  setNewMessage(''); // Clear input immediately for speed

  // 2. Create the Optimistic Message (Shows up instantly)
  const optimisticMsg = {
    _id: tempId,
    text: textToSend,
    senderModel: 'Agent',
    status: 'sending', // Triggers the spinner in our UI
    createdAt: new Date().toISOString(),
    fileType: 'text'
  };
  setMessages(prev => [...prev, optimisticMsg]);

  try {
    const token = localStorage.getItem('agentToken');
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        receiverId: selectedUser._id,
        text: textToSend,
        fileType: 'text'
      })
    });

    const data = await response.json();

    if (data.success) {
      setMessages(prev => 
        prev.map(msg => msg._id === tempId ? data.message : msg)
      );
    } else {
      setMessages(prev => 
        prev.map(msg => msg._id === tempId ? { ...msg, status: 'failed' } : msg)
      );
    }
  } catch (err) {
    console.error("Message failed to send:", err);
    setMessages(prev => 
      prev.map(msg => msg._id === tempId ? { ...msg, status: 'failed' } : msg)
    );
  }
};

if (loading) return (
  <div className="h-screen flex items-center justify-center bg-page-bg text-[10px] font-bold uppercase tracking-widest text-text-secondary">
    Initializing Secure Portal...
  </div>
);

return (
<div className="h-screen w-screen bg-page-bg flex overflow-hidden font-sans antialiased text-text-main relative transition-colors duration-300">
  <audio ref={localAudioRef} muted autoPlay playsInline style={{ display: 'none' }} />

{/* --- CALL ENGINE (FIXED POSITIONING & DESIGN STABILITY) --- */}

{callStatus !== 'idle' && (
  <>
    {/* A. LIVEKIT WEB RTC ENGINE LAYER */}
    {/* This only initializes in the background when the lkToken is actually available */}
    {lkToken && (
      <LiveKitRoom
        video={false}
        audio={true} 
        token={lkToken}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={true} 
        options={{
          publishDefaults: {
            audioPreset: { maxBitrate: 48000 },
            dtx: true, // Discontinuous Transmission: saves bandwidth during silence
          },
          adaptiveStream: true,
        }}
        onDisconnected={handleEndCall}
      >
        {/* AudioSession now contextually controls audio synchronization safely */}
        <AudioSession 
          isMuted={isMuted} 
          isMasked={activeCall?.voiceId && activeCall.voiceId !== 'natural'}
          isIncomingCall={isIncomingCall}
          setCallStatus={setCallStatus}
          setPeerConnected={setPeerConnected}
          ringtoneAudio={ringtoneAudio}
          callingAudio={callingAudio}
        />
      </LiveKitRoom>
    )}

  </>
)}
    {/* --- CONNECTION STATUS OVERLAY --- */}
    {(connectionStatus === 'offline' || connectionStatus === 'connecting') && (
      <div className={`fixed top-0 left-0 w-full z-[50000] py-1.5 flex items-center justify-center gap-3 animate-in slide-in-from-top duration-300 ${connectionStatus === 'offline' ? 'bg-[#ea0038]' : 'bg-[#0052FF]'}`}>
        <div className="flex items-center gap-2 text-white">
          {connectionStatus === 'offline' ? (
            <div className="flex items-center gap-2">
              <BsShieldLockFill className="animate-pulse" size={12} />
              <span className="text-[10px] font-black uppercase tracking-widest">Security Node Offline • Check Connection</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-black uppercase tracking-widest">Establishing Encrypted Tunnel...</span>
            </div>
          )}
        </div>
      </div>
    )}

    {/* --- SUCCESS OVERLAY --- */}
    {showSuccessOverlay && (
      <div className="fixed inset-0 z-[20000] bg-blue-600 flex flex-col items-center justify-center text-white p-6">
        <div className="bg-white/10 p-6 rounded-full mb-6">
          <BsCheckCircleFill size={60} className="text-white animate-bounce" />
        </div>
        <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-2 text-center">Activation Successful!</h1>
        <p className="text-sm md:text-lg font-medium opacity-90 text-center max-w-xs mb-8">
          Your <strong>{selectedPlan}</strong> plan has been activated.
        </p>
        <button onClick={() => window.location.reload()} className="w-full max-w-xs bg-white text-blue-600 font-black py-4 rounded-xl shadow-xl uppercase tracking-widest text-[11px]">Return to Dashboard</button>
      </div>
    )}

    {/* --- DUAL LOGIN CONFLICT OVERLAY --- */}
    {isDualLoginConflict && (
      <div className="fixed inset-0 z-[60000] bg-slate-900/98 backdrop-blur-xl flex items-center justify-center p-6">
        <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-12 text-center animate-in zoom-in duration-300">
          <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <BsShieldFillExclamation size={40} className="text-red-500 animate-pulse" />
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-4">Security Alert</h2>
          <p className="text-slate-500 text-sm mb-8">Your account is active on another device.</p>
          <div className="space-y-4">
            <button onClick={() => { localStorage.removeItem('agentToken'); window.location.reload(); }} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl uppercase tracking-widest text-[11px]">Disconnect Other Device</button>
            <button onClick={() => navigate('/login')} className="w-full bg-slate-100 text-slate-600 font-bold py-4 rounded-2xl uppercase tracking-widest text-[11px]">Cancel</button>
          </div>
        </div>
      </div>
    )}

   {/* --- SUBSCRIPTION MODAL --- */}
{!loading && !isSubscribed && !isDualLoginConflict && !showSuccessOverlay && (
  <div className="absolute inset-0 z-[10000] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-6">
    <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]">
      
      {/* Left Accent Banner */}
      <div className="bg-blue-600 p-10 text-white md:w-1/3 flex flex-col justify-between">
        <div>
          <BsShieldLockFill size={32} className="mb-4 opacity-90" />
          <h2 className="text-3xl font-black uppercase tracking-tighter mb-3">Account Inactive</h2>
          <p className="text-blue-100 text-sm opacity-90">Subscription required for dashboard access.</p>
        </div>
        <div className="mt-8 pt-8 border-t border-blue-500/50">
          <p className="text-[10px] uppercase font-bold tracking-widest opacity-60">Current Selection</p>
          <p className="text-3xl font-black">{selectedPlan}</p>
          {/* Added the selected plan's duration here for confirmation */}
          <p className="text-xs text-blue-200 mt-1 font-medium">
            Valid for {plans.find(p => p.tier === selectedPlan)?.term}
          </p>
        </div>
      </div>

      {/* Right Pricing Plan Selection */}
      <div className="p-12 md:w-2/3 bg-gray-50 flex flex-col overflow-y-auto">
        <h3 className="text-xl font-bold text-gray-800 mb-6">Choose Your Access Tier</h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {plans.map((plan) => (
            <div
              key={plan.tier}
              onClick={() => setSelectedPlan(plan.tier)}
              className={`cursor-pointer p-5 rounded-2xl border-2 transition-all relative flex flex-col justify-between h-36 ${
                selectedPlan === plan.tier 
                  ? 'border-blue-600 bg-white shadow-xl scale-[1.03]' 
                  : 'border-gray-200 bg-white opacity-80 hover:opacity-100'
              }`}
            >
              {/* Popular Badge indicator if applicable */}
              {plan.popular && (
                <span className="absolute -top-2.5 left-4 bg-orange-500 text-white text-[8px] font-black tracking-widest px-2 py-0.5 rounded-full uppercase">
                  Popular
                </span>
              )}

              <div>
                {/* Tier Label */}
                <span className={`text-[9px] font-black uppercase tracking-widest block ${selectedPlan === plan.tier ? 'text-blue-600' : 'text-gray-400'}`}>
                  {plan.tier}
                </span>
                {/* CHANGED: Added the missing Term/Duration explicitly here */}
                <span className="text-xs font-bold text-gray-500 block mt-0.5">
                  {plan.term} Access
                </span>
              </div>

              <div>
                {/* Price Label */}
                <div className="text-2xl font-black text-gray-900 leading-none">
                  ₦{plan.price}
                </div>
                {/* Frequency Context Subtitle */}
                <span className="text-[10px] text-gray-400 font-medium mt-1 block">
                  {plan.tier === 'BASIC' && 'billed monthly'}
                  {plan.tier === 'GROWTH' && 'billed every 6 months'}
                  {plan.tier === 'PROFESSIONAL' && 'billed annually'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <button 
          disabled={paymentProcessing} 
          onClick={handlePayment} 
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-4 rounded-xl uppercase tracking-widest text-[11px] transition-colors"
        >
          {paymentProcessing ? "Processing..." : `Activate ${selectedPlan} Access`}
        </button>
      </div>

    </div>
  </div>
)}

    {/* --- SIDEBAR --- */}
    <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-[30%] lg:min-w-[350px] bg-card-bg flex-col z-[100]`}>
  <header className="h-[60px] bg-page-bg px-3 flex justify-between items-center  shrink-0">
    <button onClick={() => navigate('/agent/profile')} className="h-10 w-10 rounded-full hover:bg-input-bg flex items-center justify-center">
      <BsPersonCircle size={32} className="text-text-secondary" />
    </button>
    <BsThreeDotsVertical className="cursor-pointer text-text-secondary" size={18} />
  </header>
    <div className="p-2 bg-card-bg">
    <div className="bg-input-bg flex items-center px-3 py-1.5 rounded-lg">
      <BsSearch className="text-text-secondary mr-3" size={12} />
      <input placeholder="Search" className="bg-transparent text-xs w-full outline-none text-text-main" />
    </div>
  </div>
      <div className="flex-1 overflow-y-auto">
{users.length > 0 ? users.map((user) => (
  <div
    key={user._id}
    onClick={() => handleSelectUser(user)}
    className={`flex items-center px-4 py-3 cursor-pointer hover:bg-[#f5f6f6]  ${selectedUser?._id === user._id ? 'bg-[#ebebeb]' : ''}`}
  >
    <div className="relative shrink-0">
      <div className="w-11 h-11 rounded-full overflow-hidden border bg-white">
        <img
          src={user.photoUrl}
          alt={user.firstName}
          className="w-full h-full object-cover"
          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${user.firstName}&background=random&color=fff`; }}
        />
      </div>
      <div className={`absolute -bottom-0.5 -right-0.5 border-2 border-white w-4 h-4 rounded-full ${user.status === 'online' || user.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
    </div>
    
    <div className="ml-3 flex-1 min-w-0">
      <div className="flex justify-between items-center mb-0.5">
        <h3 className="text-[13px] font-bold text-gray-800 truncate">
          {user.firstName} {user.lastName}
        </h3>
      </div>
      
      <p className="text-[11px] text-gray-500 truncate mb-0.5">{user.email}</p>
      
      {/* NEW: City and State Display */}
      {(user.city || user.state) && (
        <p className="text-[10px] font-bold text-blue-600 truncate flex items-center gap-1">
          <span className="opacity-70">📍</span>
          {user.city ? user.city : ''}{user.city && user.state ? ', ' : ''}{user.state ? user.state : ''}
        </p>
      )}
    </div>
  </div>
)) : (
  <p className="text-center text-gray-500 py-10 text-xs font-bold uppercase tracking-widest">No users connected.</p>
)}
      </div>
      <div className="p-4 border-t bg-gray-50/50">
        <button onClick={handleLogout} className="w-full flex items-center justify-center gap-3 py-3 bg-white border border-red-100 text-red-500 rounded-xl hover:bg-red-50 transition-all active:scale-95">
          <span className="text-[11px] font-black uppercase tracking-widest">Disconnect Session</span>
        </button>
      </div>
    </aside>

    {/* --- MAIN CHAT INTERFACE --- */}
<main className={`${!showSidebar ? 'flex' : 'hidden'} lg:flex flex-1 flex-col bg-page-bg relative overflow-hidden`}>
        {selectedUser ? (
        <>
<header className="h-[75px] bg-card-bg px-3 flex justify-between items-center z-30 shadow-sm relative">
    <div className="flex items-center gap-3">
    <button onClick={() => setShowSidebar(true)} className="lg:hidden p-2 text-gray-600 rounded-full">
      <BsChevronLeft size={18} />
    </button>
    
    <div onClick={(e) => { e.stopPropagation(); setShowUserModal(true); }} className="relative z-40 w-10 h-10 rounded-full overflow-hidden border bg-slate-100 cursor-pointer hover:ring-2 hover:ring-blue-400/50 pointer-events-auto">
      <img
        src={selectedUser.photoUrl}
        className="w-full h-full object-cover"
        alt="Profile"
        onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${selectedUser.firstName}&background=random&color=fff`; }}
      />
    </div>

    <div className="cursor-pointer" onClick={() => setShowUserModal(true)}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-text-main truncate leading-tight">
            {selectedUser.firstName} {selectedUser.lastName}
        </h2>
        
        {/* UPDATED: Real-time Status Indicator - Matches Sidebar Logic */}
        <span className={`flex items-center gap-1 text-[9px] font-black uppercase ${
          selectedUser.status === 'online' || selectedUser.isOnline ? 'text-green-500' : 'text-gray-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            selectedUser.status === 'online' || selectedUser.isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
          }`} />
          {selectedUser.status === 'online' || selectedUser.isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      
      {/* Show Email when Online, Last Seen when Offline */}
      {selectedUser.status === 'online' || selectedUser.isOnline ? (
        <p className="text-[11px] font-medium text-gray-500 lowercase leading-tight">
          {selectedUser.email}
        </p>
      ) : (
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">
          Last seen: {selectedUser.lastSeen ? new Date(selectedUser.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently'}
        </p>
      )}
      {(selectedUser.city || selectedUser.state) && (
        <p className="text-[9px] font-bold text-blue-600 truncate max-w-[180px] mt-0.5">
          📍 {selectedUser.city}{selectedUser.city && selectedUser.state ? ', ' : ''}{selectedUser.state}
        </p>
      )}
    </div>
  </div>

  <div className="flex items-center gap-6 text-gray-500 mr-2">
    <button onClick={() => handleStartCall(selectedUser._id)} className="hover:text-green-600 transition-colors active:scale-90 p-2" title="Start Secure Call">
      <BsTelephoneFill size={18} /> 
    </button>
    <button onClick={() => navigate('/agent/call-settings')} className="hover:text-blue-600 transition-colors active:scale-90 p-2" title="Call Settings"> 
      <BsGearFill size={20} />
    </button>
  </div>
</header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:px-20 space-y-2 z-10 flex flex-col bg-page-bg dark:bg-slate-950/50">
            {messages.length >= limit && (
              <div className="flex justify-center py-6">
                <button onClick={() => setLimit(prev => prev + 30)} className="text-[10px] font-black uppercase text-gray-500 bg-white/50 px-4 py-2 rounded-full border border-gray-300 hover:bg-white transition-colors">↑ Load Older Messages</button>
              </div>
            )}
            {messages.map((m) => {
              const isMe = m.senderId === agentData?._id;
              const msgKey = m._id || m.id || `temp-${m.createdAt}-${Math.random()}`;

            if (m.fileType === 'call_log' && m.callMetadata) {
  {/* Determine if the logged-in agent is the one who initiated the call */}
  const isMe = m.senderId === agentData?._id; 
  const isMissed = m.callMetadata.status === 'missed';

  return (
    <div 
      key={msgKey} 
      className={`w-full flex ${isMe ? 'justify-end' : 'justify-start'} my-2 animate-in fade-in zoom-in duration-500`}
    >
      <div className={`
        px-5 py-2.5 rounded-2xl flex items-center gap-4 shadow-md border max-w-[80%]
        ${isMe 
          ? 'bg-green-600 border-green-500 text-white rounded-tr-none mr-2' 
          : 'bg-white border-gray-200 text-slate-800 rounded-tl-none ml-2'}
        dark:bg-white/10 dark:backdrop-blur-md dark:border-white/10 dark:text-white
      `}>
        <div className={`p-2.5 rounded-full ${
          isMe 
            ? 'bg-white/20 text-white' 
            : isMissed ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
        }`}>
          {isMissed ? <BsTelephoneXFill size={16} /> : <BsTelephoneOutboundFill size={16} />}
        </div>

        <div className="flex flex-col">
          <p className={`text-[11px] font-black uppercase tracking-widest ${
            isMe ? 'text-white' : 'text-gray-700'
          } dark:text-white`}>
            {isMissed ? 'Missed Voice Call' : `Voice Call • ${m.callMetadata.duration || 0}s`}
          </p>
          <span className={`text-[9px] font-bold ${
            isMe ? 'text-white/70' : 'text-gray-400'
          } dark:text-white/60`}>
            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

              return (
                <div
                  key={msgKey}
                  onMouseDown={() => isMe && startHold(m._id)}
                  onMouseUp={stopHold}
                 className={`max-w-[85%] md:max-w-[65%] px-3 py-1.5 rounded-lg shadow-sm relative flex flex-col  ${isMe 
                ? 'bg-green-600 text-white self-end rounded-tr-none' 
                : 'bg-card-bg text-text-main border dark:border-slate-800 self-start rounded-tl-none'
                 } mb-1`}>
                  {(m.fileType === 'image' || m.fileType === 'video') && (
                    <div className="relative mb-1.5 mt-0.5 group">
                      {m.fileType === 'image' ? (
                        <img src={m.fileUrl} onClick={() => setFullscreenImage(m.fileUrl)} className="rounded-lg bg-gray-100 object-cover w-full cursor-pointer hover:opacity-95" alt="attachment" />
                      ) : (
                        <div className="relative">
                          <video className="rounded-lg w-full bg-black cursor-pointer" onClick={() => setFullscreenVideo(m.fileUrl)}><source src={m.fileUrl} type="video/mp4" /></video>
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><BsPlayFill size={30} className="text-white bg-black/40 p-2 rounded-full backdrop-blur-sm" /></div>
                        </div>
                      )}
                      <button onClick={() => handleDownload(m.fileUrl, m.fileType)} className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><BsDownload size={14} /></button>
                    </div>
                  )}
                    {m.text && <p className="text-[13px] md:text-[15px] leading-relaxed break-words">{m.text}</p>}
                  <div className="flex items-center justify-end gap-1 mt-1 border-t border-black/5 pt-0.5">
                    <span className="text-[9px] text-gray-400 font-bold uppercase">{new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {isMe && (
                      <div className="flex items-center ml-1">
                        {m.status === 'sending' ? <div className="w-2.5 h-2.5 border-2 border-t-blue-500 rounded-full animate-spin" /> : 
                         m.status === 'failed' ? <BsPlusLg className="rotate-45 text-red-500" size={10} onClick={() => handleResend(m)} /> :
                         <BsCheckAll className={m.status === 'seen' ? 'text-blue-500' : 'text-gray-400'} size={16} />}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-4 shrink-0 w-full" />
          </div>

            <footer className="min-h-[48px] bg-card-bg px-1 py-1 flex items-center justify-between gap-1 z-10">
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,video/*" className="hidden" />
            <input type="file" ref={cameraInputRef} onChange={handleFileUpload} accept="image/*,video/*" capture="environment" className="hidden" />
            <div className="flex items-center shrink-0">
              <button onClick={() => fileInputRef.current.click()} disabled={isUploading} className="p-1.5 hover:bg-gray-200 rounded-full"><BsPaperclip size={18} className="text-gray-500" /></button>
              <button onClick={() => cameraInputRef.current.click()} disabled={isUploading} className="p-1.5 hover:bg-gray-200 rounded-full"><BsCameraFill size={18} className="text-gray-500" /></button>
            </div>
            <form onSubmit={handleSendMessage} className="flex-1 flex items-center gap-1">
              <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Message" className="w-full bg-input-bg text-text-main px-3 py-1.5 rounded-full text-[14px] outline-none  shadow-sm" />
              <button type="submit" disabled={!newMessage.trim() || isUploading} className={`p-2 rounded-full shadow-sm ${newMessage.trim() ? 'bg-blue-600 text-white' : 'bg-gray-300 text-white'}`}><BsSend size={15} /></button>
            </form>
        </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-30 text-text-main">
            <BsShieldLockFill size={40} className="mb-4" />
            <h1 className="text-2xl font-black uppercase tracking-widest text-blue-950">ZingConnect</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest">Secure Terminal</p>
          </div>
        )}

        {/* --- USER DETAILS MODAL --- */}
        {showUserModal && selectedUser && (
          <div className="fixed inset-0 z-[50000] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowUserModal(false)} />
            <div className="relative w-full max-w-[340px] bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
              <div className="h-24 bg-gradient-to-br from-blue-600 to-indigo-700 w-full" />
              <div className="px-6 pb-8 flex flex-col items-center">
                <div className="relative -mt-12 mb-4 w-24 h-24 rounded-[2rem] overflow-hidden bg-gray-100">
                  <img 
                    src={selectedUser.photoUrl} 
                    className="w-full h-full object-cover" 
                    alt="Profile" 
                    onError={(e) => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${selectedUser.firstName}&background=random&color=fff`; }}
                  />
                </div>
                <h3 className="text-base font-black text-slate-800">{selectedUser.firstName} {selectedUser.lastName}</h3>
                <p className="text-[10px] font-bold text-blue-600 uppercase mb-6">Verified Client</p>
                
                <div className="w-full space-y-2.5">
                  {/* Email */}
                  <div className="bg-slate-50 p-3 rounded-2xl">
                    <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Email Address</p>
                    <p className="text-[11px] font-bold text-slate-700 break-all">{selectedUser.email}</p>
                  </div>

                  {/* Phone */}
                  <div className="bg-slate-50 p-3 rounded-2xl">
                    <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Phone Number</p>
                    <p className="text-[11px] font-bold text-slate-700">
                      {selectedUser.phoneNumber || selectedUser.phone || 'No Phone Registered'}
                    </p>
                  </div>

                  {/* Location Details */}
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <p className="text-[8px] font-black uppercase text-slate-400 mb-1">Location Details</p>
                    <p className="text-[11px] font-bold text-slate-700 leading-relaxed">
                      {selectedUser.address && <span>{selectedUser.address}<br /></span>}
                      <span className="text-blue-600">
                        {selectedUser.city || ''}
                        {selectedUser.city && selectedUser.state ? ', ' : ''}
                        {selectedUser.state || ''}
                      </span>
                      {!selectedUser.address && !selectedUser.city && !selectedUser.state && 'Information Not Provided'}
                    </p>
                  </div>
                </div>
                
                <button 
                  onClick={() => setShowUserModal(false)}
                  className="mt-6 w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-2xl transition-colors"
                >
                  Close Profile
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- MEDIA PREVIEW OVERLAY --- */}
        {previewUrl && (
          <div className="fixed inset-0 z-[70000] bg-slate-950 flex flex-col">
            <div className="p-4 flex justify-between items-center bg-slate-900/90 text-white">
              <button onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }} className="p-2 hover:bg-white/10 rounded-full"><BsXLg size={24} /></button>
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Media Preview</span>
              <div className="w-10" />
            </div>
            <div className="flex-1 flex items-center justify-center p-4">
              {previewFile?.type.startsWith('video') ? (
                <video src={previewUrl} controls className="max-w-full max-h-[65vh] rounded-2xl" />
              ) : (
                <img src={previewUrl} className="max-w-full max-h-[65vh] rounded-2xl object-contain" alt="Preview" />
              )}
            </div>
            <div className="p-6 bg-slate-900">
              <div className="max-w-4xl mx-auto flex items-center gap-4">
                <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption..." className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white text-sm outline-none" />
                <button onClick={handleFinalSend} className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center"><BsSend size={28} className="text-white" /></button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AgentDashboard;