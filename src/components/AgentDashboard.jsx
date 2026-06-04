import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { useAuth } from "../context/AuthContext";
import { secureFetch } from "../../api/utils/api";
import { initializeUserE2EEKeys, encryptMessageText, decryptMessageText } from '../utils/cryptoEngine'; 

const formatLastSeen = (lastSeenDate, ticker) => {
  if (!lastSeenDate) return 'Recently';
  const now = ticker ? new Date(ticker) : new Date();
  const lastSeen = new Date(lastSeenDate);
    if (isNaN(lastSeen.getTime())) {
    return 'Recently';
  }
  const diffInSeconds = Math.floor((now - lastSeen) / 1000);
    if (diffInSeconds < 0) return 'Just now';
  
  if (diffInSeconds < 60) return 'Just now';
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} ${diffInMinutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} ${diffInHours === 1 ? 'hour' : 'hours'} ago`;
  }
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) {
    return `${diffInDays} days ago`;
  }
  
  return lastSeen.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
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

export const AgentDashboard = () => {
  const navigate = useNavigate();
  const { token, isLoading, setToken } = useAuth();
  const { slug } = useParams();

  
  const [agentData, setAgentData] = useState(null);
  const [agentPrivateKey, setAgentPrivateKey] = useState(null); // Key material
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
  const [showFullScreenCall, setShowFullScreenCall] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [lkToken, setLkToken] = useState(null);
  const [isEnding, setIsEnding] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [activeCall, setActiveCall] = useState(null);
  const [callStatus, setCallStatus] = useState('idle'); 
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [activeCaller, setActiveCaller] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [callTime, setCallTime] = useState(0);

  const [timeTicker, setTimeTicker] = useState(Date.now());

  // Subscription States
const [isSubscribed, setIsSubscribed] = useState(null); // Use null instead of false
  const [selectedPlan, setSelectedPlan] = useState("BASIC");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);  
  const [isUploading, setIsUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState(null); 
  const [previewUrl, setPreviewUrl] = useState(null);   
  const [caption, setCaption] = useState("");          

  const messagesEndRef = useRef(null);
  const connectionTimeoutRef = useRef(null);
  const localAudioRef = useRef(null);
  const scrollRef = useRef(null);
  const userStreamRef = useRef(null);
  const peerConnectedRef = useRef(false);
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));  
  const ringtoneAudio = useRef(new Audio('/sounds/ringtone.mp3')); // Incoming
  const callingAudio = useRef(new Audio('/sounds/calling.wav'));  // Outgoing
  const lastNotifiedId = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const timerRef = useRef(null);
  const isTransitioningRef = useRef(false);
  const pollingIntervalRef = useRef(null);
  const activeCallRef = useRef(null);
  const activeCallerRef = useRef(null);
  const pollingRef = useRef(null); 
  const aiMediaRecorderRef = useRef(null);
  const selectedUserRef = useRef(selectedUser);
const agentDataRef = useRef(agentData);
const agentPrivateKeyRef = useRef(agentPrivateKey);

    const slugFromUrl = slug || agentData?.slug || '';


  let isFetching = false;
  const plans = [
    {
      tier: 'BASIC',
      term: '1 Month',
      price: '8,500', 
      frequency: '/mo',
      popular: false,
      features: ['Instant Link', 'Unlimited Chats', '24/7 Support'],
    },
    {
      tier: 'GROWTH',
      term: '6 Months',
      price: '51,000', 
      frequency: '/6mo',
      popular: true,
      features: ['All Basic', 'Priority Routing', 'Enhanced Support'],
    },
    {
      tier: 'PROFESSIONAL',
      term: '1 Year',
      price: '102,000', 
      frequency: '1yr',
      popular: false,
      features: ['All Growth', 'Deep Analytics', 'Dedicated Priority Support'],
    },
  ];

  const handleLogout = async (e) => {
    e.preventDefault();
    try {
      await secureFetch('/api/agents/logout', token, { method: 'POST' });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      const targetUrl = slug ? `/${slug}` : '/';
      window.location.replace(targetUrl); 
    }
  };


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
      const res = await secureFetch(`/api/calls/status/${roomName}`, token, { 
        method: 'GET' 
      });
      
      const data = await res.json();
      const isTimeout = (Date.now() - startTime) > 45000; 
      
      if (data.success && (['ended', 'rejected', 'missed'].includes(data.status) || (isTimeout && data.status === 'calling'))) {
        console.log("🚫 Call state changed or timed out.");
        clearInterval(pollInterval);
        handleEndCall(); 
      }
    } catch (err) {
      if (err.message === 'Unauthorized') {
        console.warn("Polling halted: Unauthorized");
        clearInterval(pollInterval);
        setIsDualLoginConflict(true);
      }
      console.error("Poller Error:", err);
    }
  }, 4000); 
  
  if (pollingIntervalRef) pollingIntervalRef.current = pollInterval;
};

  const handleScroll = async (e) => {
  const container = e.target;
    if (container.scrollTop < 50 && !isFetchingMore && messages.length >= limit) {
    setIsFetchingMore(true);
    const oldScrollHeight = container.scrollHeight;
        setLimit(prev => prev + 30);
    setTimeout(() => {
      setIsFetchingMore(false);
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight - oldScrollHeight;
      });
    }, 500);
  }
};
const fetchMessages = async (userId, limit = 30, targetUserCryptoProfile = null) => {
  // 🛡️ HARD GUARD: If we already know the session is conflicted, don't even try
  if (isFetching || isDualLoginConflict) return null; 
  
  isFetching = true;
  
  try {
    const res = await secureFetch(`/api/messages/${userId}?limit=${limit}`, token, {
      method: 'GET'
    });
    
    // 🛡️ HANDLE 403/401 EXPLICITLY
    if (res.status === 403 || res.status === 401) {
      console.error("⛔ Authentication session invalid. Aborting further fetches.");
      setIsDualLoginConflict(true); // This state should trigger a UI redirect or modal
      return null;
    }

    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    
    const data = await res.json();
    
    if (data.success && data.messages) {
      const decryptedMessages = await Promise.all(
        data.messages.map(async (msg) => {
          // Check if we have the private key BEFORE attempting to decrypt
          const myKey = localStorage.getItem(`zing_secure_pk_${agentData._id}`);
          
          if (msg.isEncrypted && targetUserCryptoProfile?.publicKeyJwk && myKey) {
            try {
              const clearText = await decryptMessageText(
                msg.text,
                msg.iv,
                targetUserCryptoProfile.publicKeyJwk,
                agentData._id
              );
              return { ...msg, text: clearText };
            } catch (decryptionError) {
              return { ...msg, text: "🔒 [Decryption Failed]" };
            }
          }
          return msg; 
        })
      );
      return decryptedMessages;
    }
    return null;
  } catch (err) {
    console.error("Fetch error:", err);
    return null;
  } finally {
    isFetching = false; 
  }
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
        const res = await secureFetch(`/api/calls/accept/${callId}`, token, {
      method: 'POST'
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
    if (currentCallId) {
    try {
      await secureFetch(`/api/calls/end/${currentCallId}`, token, {
        method: 'POST',
        body: JSON.stringify({ callId: currentCallId })
      });
    } catch (e) {
      console.warn("Call end sync skipped due to session or network:", e);
    }
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
    const interval = setInterval(() => {
      setTimeTicker(Date.now());
    }, 60000); 
    return () => clearInterval(interval);
  }, []);
  
// 🛡️ Hardware Device Identity Handshake for the Agent
useEffect(() => {
  const provisionAgentCryptoEnvironment = async () => {
    console.log("🔍 [Crypto] Checking provisioning dependencies:", {
      isLoading,
      hasToken: !!token,
      agentId: agentData?._id
    });

    if (!isLoading && token && agentData?._id) {
      console.log("🔒 [Crypto] Initializing agent cryptographic keys for ID:", agentData._id);      
      try {
        const agentId = String(agentData._id);
        const success = await initializeUserE2EEKeys(agentId, token);
        
        if (success) {
          const savedKey = localStorage.getItem(`zing_secure_pk_${agentId}`);
          
          if (savedKey) {
            setAgentPrivateKey(JSON.parse(savedKey));
            console.log("✅ [Crypto] Agent private key confirmed in storage and loaded to state.");
          } else {
            console.error("❌ [Crypto] initializeUserE2EEKeys returned success, but key was NOT found in storage!");
          }
        } else {
          console.error("❌ [Crypto] initializeUserE2EEKeys returned false.");
        }
      } catch (err) {
        console.error("❌ [Crypto] Failed to load agent crypto keys:", err);
      }
    }
  };
  
  provisionAgentCryptoEnvironment();
}, [token, isLoading, agentData?._id]);

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
        const res = await secureFetch(`/api/calls/status/${currentCallId}`, token, {
          method: 'GET'
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
  
  const handleStatusUpdate = ({ userId, status }) => {
    // 1. Update the main list
    setUsers(prevUsers => prevUsers.map(u => 
      u.id === userId ? { ...u, status } : u
    ));
    
    // 2. Update the selected user (if they are currently open)
    setSelectedUser(prev => (prev?.id === userId ? { ...prev, status } : prev));
  };

  socket.on('user_status_update', handleStatusUpdate);
  return () => socket.off('user_status_update', handleStatusUpdate);
}, [socket]);

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
      const res = await secureFetch(`/api/calls/status/${callId}`, token, {
        method: 'GET'
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
      const res = await secureFetch(`/api/calls/check-incoming`, token, {
        method: 'GET'
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

      if (selectedUser?._id && agentData?._id) {
        try {
          const response = await secureFetch(`/api/messages/${selectedUser._id}?limit=30`, token, {
            method: 'GET'
          });
          
          if (!response.ok) throw new Error("Sync failed");
          const data = await response.json();
          
          if (data.success && data.messages) {
            // 🔓 Decrypt the batch on-the-fly when resuming visibility
            const decryptedMessages = await Promise.all(
              data.messages.map(async (msg) => {
                if (msg.isEncrypted && selectedUser?.publicKeyJwk) {
                  try {
                    const clearText = await decryptMessageText(
                      msg.text,
                      msg.iv,
                      selectedUser.publicKeyJwk,
                      agentData._id
                    );
                    return { ...msg, text: clearText };
                  } catch (e) {
                    return { ...msg, text: "🔒 [Decryption Failed]" };
                  }
                }
                return msg;
              })
            );
            setMessages(decryptedMessages);
          }
        } catch (err) {
          console.warn("Message catch-up failed:", err);
        }
      }
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}, [agentData?._id, selectedUser?._id, callStatus, socket, token]);

useEffect(() => {
  const currentCallId = activeCall?.roomName || activeCall?.callId || activeCall?._id;

  // 1. Guard Clause: Stop if no ID, idle, or already in a security conflict
  if (!currentCallId || typeof currentCallId !== 'string' || callStatus === 'idle' || isDualLoginConflict) {
    return;
  }

  const syncStatus = async () => {
    if (!['calling', 'ringing', 'connecting', 'connected'].includes(callStatus)) return;
    try {
      // 2. Use secureFetch (token = null for cookie auth)
      const res = await secureFetch(`/api/calls/status/${currentCallId}`, token, {
        method: 'GET'
      });
      // 3. Handle Unauthorized/Forbidden (Conflict)
      if (res.status === 401 || res.status === 403) {
        setIsDualLoginConflict(true); // This stops the interval via the dependency below
        return;
      }
      if (!res.ok) {
        if (res.status === 404) handleEndCall();
        return;
      }
      const data = await res.json(); 
      // 4. Update status based on data
      if (data?.status === 'ringing' && callStatus === 'calling') {
        setCallStatus('ringing');
      }
      if (data?.status === 'connected' && callStatus !== 'connected') {
        if (isIncomingCall) {
          setCallStatus('connected');
          setPeerConnected(true);
        } else {
          console.log("📡 DB connected, awaiting socket acceptance.");
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
}, [callStatus, activeCall?.roomName, activeCall?.callId, activeCall?._id, handleEndCall, isIncomingCall, isDualLoginConflict]);

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

useEffect(() => {
  selectedUserRef.current = selectedUser;
  agentDataRef.current = agentData;
  agentPrivateKeyRef.current = agentPrivateKey;
}, [selectedUser, agentData, agentPrivateKey]);

useEffect(() => {
  if (isDualLoginConflict) return;

  const heartBeat = setInterval(async () => {
    try {
      const response = await secureFetch('/api/agents/heartbeat', token, {
        method: 'POST' 
      });
            if (response.status === 403) {
        const data = await response.json();
        if (data.reason === 'dual_login') {
          setIsDualLoginConflict(true); 
        }
      }
    } catch (err) {
      console.error("Heartbeat sync failed:", err);
    }
  }, 60000); 

  return () => clearInterval(heartBeat);
  }, [isDualLoginConflict]);

 useEffect(() => {
  let isMounted = true;
  const token = localStorage.getItem('accessToken'); 

  // Load external dependency safely
  if (!document.querySelector('script[src*="flutterwave"]')) {
    const script = document.createElement('script');
    script.src = "https://checkout.flutterwave.com/v3.js";
    script.async = true;
    document.body.appendChild(script);
  }

  const fetchInitialData = async () => {
    // 🛡️ Ensure redirect uses the agent-specific slug
    if (!token) {
      navigate(`/agent/login/${slug}`);
      return;
    }

    setLoading(true);
    try {
      const [profileResponse, usersResponse] = await Promise.allSettled([
        secureFetch('/api/agents/profile/me', token, { method: 'GET' }),
        secureFetch('/api/agents/my-users', token, { method: 'GET' })
      ]);

      if (!isMounted) return;

      // Handle Profile Request
      if (profileResponse.status === 'rejected' || !profileResponse.value.ok) {
        const res = profileResponse.value;
        if (res?.status === 401 || res?.status === 403) {
          const errorData = await res.json().catch(() => ({}));
          if (errorData.reason === 'dual_login') {
            setIsDualLoginConflict(true);
          } else {
            localStorage.removeItem('accessToken'); 
            navigate(`/agent/login/${slug}`);
          }
          return;
        }
        throw new Error("Profile data retrieval failed");
      }
      
      const profileData = await profileResponse.value.json();
      
      if (profileData.agent) {
        setAgentData(profileData.agent);
        const subscribed = !!profileData.agent.isSubscribed;
        setIsSubscribed(subscribed); 
        if (profileData.agent.plan) setSelectedPlan(profileData.agent.plan);

        // Handle User Request separately to prevent cascading failure
        if (subscribed && usersResponse.status === 'fulfilled') {
          const uRes = usersResponse.value;
          if (uRes.ok) {
            const userData = await uRes.json();
            if (userData.success) setUsers(userData.users);
          } else if (uRes.status === 403) {
            console.warn("User list access forbidden.");
            setIsDualLoginConflict(true);
          }
        }
      }
    } catch (err) {
      console.error("Initialization error:", err);
    } finally {
      if (isMounted) setLoading(false);
    }
  };

  fetchInitialData();
  return () => { isMounted = false; };
}, [navigate, slug, localStorage.getItem('accessToken')]); // Added dependency for safety

const handlePayment = async () => {
  if (!agentData || !agentData.email) {
    alert("Profile data is still loading. Please wait a moment or refresh.");
    return;
  }
  setPaymentProcessing(true);
  
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
      },
      customizations: {
        title: "ZingConnect",
        description: `Activation for ${activePlan.tier} Plan (₦${activePlan.price})`,
        logo: "https://cdn-icons-png.flaticon.com/512/9431/9431166.png",
      },
      callback: async (response) => {
        try {
          const token = localStorage.getItem('accessToken');

          const verifyRes = await secureFetch('/api/subscriptions/verify', token, {
            method: 'POST',
            body: JSON.stringify({
              transaction_id: response.transaction_id,
              plan: activePlan.tier,
              ngnAmount: finalNairaAmount
            })
          });

          if (verifyRes.status === 401 || verifyRes.status === 403) {
            setIsDualLoginConflict(true);
            setPaymentProcessing(false);
            return;
          }

          if (verifyRes.ok) {
            const data = await verifyRes.json();
            
            // ✅ CORRECTION: Update React state immediately instead of reloading
            setIsSubscribed(true);
            setAgentData(prev => ({ 
              ...prev, 
              ...data.agent,
              isSubscribed: true 
            }));
            
            setShowSuccessOverlay(true);
            setPaymentProcessing(false);
          } else {
            const errData = await verifyRes.json();
            alert(errData.message || "Verification failed");
            setPaymentProcessing(false);
          }
        } catch (err) {
          console.error("Verification error:", err);
          alert("Connection error during verification.");
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
  const originalMessages = [...messages];
  // Standardized on _id
  setMessages(prev => prev.filter(m => m._id !== msgId));

  try {
    const res = await secureFetch(`/api/messages/${msgId}`, token, {
      method: 'DELETE'
    });

    if (res.status === 401 || res.status === 403) {
      setIsDualLoginConflict(true);
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      throw new Error("Server rejected deletion");
    }
  } catch (err) {
    console.error("Delete request failed:", err);
    setMessages(originalMessages);
    if (err.message !== "Unauthorized") {
      alert("Failed to delete message from server.");
    }
  }
};
const handleFinalSend = async () => {
  if (!previewFile || isUploading || !selectedUser) return;
  setIsUploading(true);

  try {
    const detectedType = previewFile.type.startsWith('video/') ? 'video' : 'image';
    const rawCaption = caption;

    // 1. 🔒 Encrypt the caption if the target user has a public key profile
    let finalCaption = rawCaption.trim();
    let encryptionIv = null;
    let isEncrypted = false;

    if (selectedUser?.publicKeyJwk) {
      const encryptedData = await encryptMessageText(
        rawCaption.trim(),
        selectedUser.publicKeyJwk,
        agentData._id
      );
      finalCaption = encryptedData.cipherText;
      encryptionIv = encryptedData.iv;
      isEncrypted = true;
    }

    // 2. Get Signed URL
    const urlResponse = await secureFetch('/api/messages/get-upload-url', token, {
      method: 'POST',
      body: JSON.stringify({ fileName: previewFile.name, fileType: previewFile.type })
    });
    
    if (!urlResponse.ok) throw new Error("Failed to retrieve upload signature");
    const { uploadUrl, key } = await urlResponse.json();

    // 3. Direct upload to Cloud
    const directUpload = await fetch(uploadUrl, {
      method: 'PUT',
      body: previewFile,
      headers: { 'Content-Type': previewFile.type }
    });

    if (!directUpload.ok) throw new Error("Cloud upload failed");

    // 4. Confirm to DB with encrypted metadata
    const confirmResponse = await secureFetch('/api/messages/confirm-upload', token, {
      method: 'POST',
      body: JSON.stringify({
        receiverId: selectedUser._id,
        receiverModel: selectedUser.modelType || 'User',
        text: finalCaption,      // 🔒 Encrypted
        iv: encryptionIv,        // 🔒 IV
        isEncrypted: isEncrypted,// 🔒 Flag
        fileUrl: key,
        fileType: detectedType
      })
    });

    const finalData = await confirmResponse.json();
    if (finalData.success) {
      // 5. 🔓 Decrypt locally for the UI layer
      let finalMsg = finalData.message;
      if (finalMsg.isEncrypted && selectedUser?.publicKeyJwk) {
        finalMsg.text = await decryptMessageText(
          finalMsg.text, 
          finalMsg.iv, 
          selectedUser.publicKeyJwk, 
          agentData._id
        );
      }

      setMessages(prev => [...prev, finalMsg]);
      
      // Cleanup
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewFile(null);
      setCaption("");
    } else {
      throw new Error(finalData.message || "Database confirmation failed");
    }
  } catch (err) {
    console.error("Upload process error:", err);
    alert("Upload failed. Please check your connection.");
  } finally {
    setIsUploading(false);
  }
};

const handleDisconnect = async (e) => {
  e.preventDefault();
  
  try {
    await secureFetch('/api/agents/logout', { method: 'POST' });
  } catch (err) {
    console.error("Logout request failed:", err);
  } finally {
    const targetUrl = slug ? `/${slug}` : '/';
    window.location.replace(targetUrl);
  }
};

const handleSelectUser = async (user) => {
  if (window.innerWidth < 1024) setShowSidebar(false);

  setSelectedUser(user);
  setMessages([]);
  setIsInitialLoad(true);
  setLimit(30);

  if (socket) socket.emit('join-chat', user._id);

  try {
    const response = await secureFetch(`/api/messages/${user._id}?limit=30`, token, {
      method: 'GET'
    });

    if (response.ok) {
      setConnectionStatus('connected');
      const data = await response.json();
      const freshUserData = data.user || data.clientDetails;

      if (freshUserData) {
        setSelectedUser(prev => {
          const merged = { ...prev, ...freshUserData };
          if (!merged.publicKeyJwk && prev?.publicKeyJwk) {
            merged.publicKeyJwk = prev.publicKeyJwk;
          }
          return merged;
        });
      }

      if (data.success && Array.isArray(data.messages)) {
        const targetUser = freshUserData || user;
        
        // Use the Ref for the private key
        const currentKey = agentPrivateKeyRef.current;

        const decryptedHistory = await Promise.all(
          data.messages.map(async (msg) => {
            if (msg.isEncrypted && targetUser?.publicKeyJwk) {
              try {
                // MODIFIED: Pass currentKey (from ref) to ensure fast, 
                // in-memory decryption
                return await decryptMessageText(
                  msg.text,
                  msg.iv,
                  targetUser.publicKeyJwk,
                  agentData._id,
                  currentKey // Assuming your function signature supports this
                );
              } catch (e) {
                return { ...msg, text: "🔒 [Decryption Failed]" };
              }
            }
            return msg;
          })
        );
        setMessages(decryptedHistory);
      }

      await secureFetch(`/api/messages/mark-read/${user._id}`, token, {
        method: 'PATCH'
      });
    }
  } catch (err) {
    setConnectionStatus('connecting');
    console.error("Failed to load chat history:", err);
  }
};

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
  // 1. Guard clause: Do not run if we are in an invalid state
  if (!isSubscribed || !agentData?._id || isDualLoginConflict) return;

  const refreshUserList = async () => {
    try {
      // 🛡️ Pass current token explicitly
      const res = await secureFetch('/api/agents/my-users', token, { method: 'GET' });

      // 2. Explicit Auth Handling
      if (res.status === 401 || res.status === 403) {
        console.warn("⛔ Session invalid (403/401). Stopping auto-refresh.");
        setIsDualLoginConflict(true); 
        return; 
      }

      if (!res.ok) {
        console.error(`Refresh failed with status: ${res.status}`);
        return;
      }

      const data = await res.json();
      
      if (data.success && data.users) {
        setUsers(prevUsers => {
          return data.users.map(newUser => {
            const existingUser = prevUsers.find(u => u._id === newUser._id);
            // Carry over existing public keys if the API response is missing them
            return (existingUser && !newUser.publicKeyJwk && existingUser.publicKeyJwk)
              ? { ...newUser, publicKeyJwk: existingUser.publicKeyJwk }
              : newUser;
          });
        });
      }
    } catch (err) { 
      console.warn("Network error during user list refresh:", err); 
    }
  };

  // 3. Initialize immediately
  refreshUserList();

  // 4. Set interval
  const interval = setInterval(refreshUserList, 15000);

  // 5. Cleanup: Clear interval on unmount or dependency change
  return () => clearInterval(interval);
}, [isSubscribed, agentData?._id, isDualLoginConflict, token]); // Added 'token' dependency

useEffect(() => {
  if (!selectedUser?._id || ['calling', 'ringing', 'connected'].includes(callStatus)) return;

  const refreshMessages = async () => {
    if (document.visibilityState !== 'visible') return;

    const incomingMsgs = await fetchMessages(selectedUser._id, limit);
    if (!incomingMsgs) return;
    setMessages(prev => {
      const isNew = incomingMsgs.length !== prev.length || 
                    incomingMsgs[incomingMsgs.length - 1]?._id !== prev[prev.length - 1]?._id;
      
      if (isNew) {
        // Notification logic
        const latest = incomingMsgs[incomingMsgs.length - 1];
        if (latest?.senderModel === 'User' && latest._id !== lastNotifiedId.current) {
          lastNotifiedId.current = latest._id;
          notificationSound.current?.play().catch(() => {});
        }
        return incomingMsgs;
      }
      return prev;
    });
  };

  const interval = setInterval(refreshMessages, 5000); // 5s is good for active chat
  return () => clearInterval(interval);
}, [selectedUser?._id, callStatus, limit]); // Only re-run if chat or status changes
useEffect(() => {
  const setupNotifications = async () => {
    // 1. Ensure token is available from context
    if (!token) return;

    // Preventive check matching your user optimization flow
    if (localStorage.getItem('agentPushSynced') === 'true') return;

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

      // ✨ CRITICAL FIX: Explicitly serialize the native PushSubscription instance
      const subData = subscription.toJSON();

      const response = await secureFetch('/api/save-subscription', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          subscription: subData, // Send clean, stringified JSON literal parameters
          userType: 'agent' 
        }) 
      });

      if (response.ok) {
        localStorage.setItem('agentPushSynced', 'true');
        console.log("Agent Mobile Push Synced to DB");
      } else {
        throw new Error(`Sync failed with status: ${response.status}`);
      }
    } catch (err) {
      console.error("Agent Push setup failed:", err);
    }
  };

  if ('serviceWorker' in navigator && 'PushManager' in window) {
    setupNotifications();
  }
}, [token]);

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
  
  // Ensure notification permission is handled once
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  const handleIncomingMessage = async (data, callback) => {
    // 1. Acknowledge receipt
    if (callback) callback({ status: 'received' });

    console.log("📥 Real-time Socket Message Detected:", data);
    if (data._id && data._id === lastNotifiedId.current) return;
    lastNotifiedId.current = data._id;

    // 2. 🔓 CRYPTO DECRYPTION LAYER (Using Refs for latest state)
    const currentUser = selectedUserRef.current;
    const currentAgent = agentDataRef.current;
    const currentKey = agentPrivateKeyRef.current;

    let processedData = { ...data };
    if (processedData.isEncrypted) {
      if (currentUser?.publicKeyJwk && currentKey) {
        try {
          processedData.text = await decryptMessageText(
            processedData.text,
            processedData.iv,
            currentUser.publicKeyJwk,
            currentAgent?._id // Passing Agent ID to resolve the private key
          );
        } catch (err) {
          console.error("🔒 Socket decryption error:", err);
          processedData.text = "🔒 [Decryption Failed]";
        }
      } else {
        processedData.text = "🔒 [Secure Channel Not Ready]";
      }
    }

    // 3. Update state with decrypted content
    const isChattingWithSender = currentUser && 
      (processedData.senderId === currentUser._id || processedData.senderId === currentUser.id);
    
    if (isChattingWithSender) {
      setMessages((prev) => {
        if (prev.some(m => m._id === processedData._id)) return prev;
        return [...prev, processedData];
      });
      
      secureFetch(`/api/messages/mark-read/${currentUser._id}`, token, {
        method: 'PATCH'
      }).catch(err => console.error("Mark read error:", err));
    }

    // 4. Notifications
    if (processedData.senderModel === 'User') {
      if (notificationSound.current) {
        notificationSound.current.currentTime = 0;
        notificationSound.current.play().catch((err) => 
          console.warn("🔊 Notification audio context autoplay restricted:", err.message)
        );
      }
      
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);

      const shouldShowPopup = document.visibilityState !== 'visible' || !isChattingWithSender;
      if (Notification.permission === "granted" && shouldShowPopup) {
        const notificationBody = processedData.isEncrypted 
          ? "You received an encrypted message." 
          : (processedData.text || "Sent a file");

        const popup = new Notification(`Message from ${processedData.senderName || 'Client'}`, {
          body: notificationBody,
          icon: processedData.senderPhoto || '/favicon.ico',
          tag: 'zing-msg',
          renotify: true
        });
        popup.onclick = () => { window.focus(); popup.close(); };
      }
    }
  };

  socket.on('RECEIVE_PRIVATE_MESSAGE', handleIncomingMessage);
  return () => socket.off('RECEIVE_PRIVATE_MESSAGE', handleIncomingMessage);
}, [socket]); // Only re-bind if the socket connection itself changes

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
  
  if (!selectedUser || !newMessage.trim() || isUploading) return;

  // 1. 🛡️ SILENT RECOVERY GUARD
  let activeUser = selectedUser;
  if (!activeUser.publicKeyJwk) {
    console.warn("🔒 Key missing in state. Attempting silent sync...");
    try {
      const res = await secureFetch(`/api/users/profile/${activeUser._id}`, token);
      const data = await res.json();
      
      if (data.user?.publicKeyJwk) {
        activeUser = { ...activeUser, ...data.user };
        setSelectedUser(activeUser);
      } else {
        throw new Error("Could not recover secure key.");
      }
    } catch (err) {
      console.error("Recovery failed:", err);
      alert("Secure channel is currently unavailable. Please ensure the user has initialized their session.");
      return;
    }
  }

  const textToSend = newMessage;
  const tempId = Date.now().toString();
  setNewMessage('');

  // 2. Optimistic UI update
  const optimisticMsg = {
    _id: tempId,
    tempId: tempId,
    text: textToSend,
    senderId: agentData._id,
    senderModel: 'Agent',
    receiverId: activeUser._id,
    receiverModel: activeUser.modelType || 'User',
    status: 'sending',
    createdAt: new Date().toISOString(),
    fileType: 'text'
  };

  setMessages(prev => [...prev, optimisticMsg]);
  setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

  try {
    // 3. STRICT CRYPTOGRAPHIC SHIELDING
    if (!activeUser.publicKeyJwk) {
      throw new Error("Encryption key missing. Transmission aborted for security.");
    }

    const encryptedData = await encryptMessageText(
      textToSend,
      activeUser.publicKeyJwk,
      agentData._id
    );
    
    if (!encryptedData.isEncrypted) {
      throw new Error("Encryption failed: Payload remains insecure.");
    }

    const response = await secureFetch('/api/messages/send', token, {
      method: 'POST',
      body: JSON.stringify({
        receiverId: activeUser._id,
        receiverModel: activeUser.modelType || 'User',
        text: encryptedData.cipherText,
        iv: encryptedData.iv,
        isEncrypted: true,
        fileType: 'text'
      })
    });

    const data = await response.json();

    if (data.success) {
      let finalizedMessage = { ...data.message };
      
      // 4. Local runtime decryption for confirmation
      // Using the agentPrivateKeyRef for high-performance in-memory access
      finalizedMessage.text = await decryptMessageText(
        finalizedMessage.text,
        finalizedMessage.iv,
        activeUser.publicKeyJwk,
        agentData._id,
        agentPrivateKeyRef.current 
      );

      setMessages(prev => 
        prev.map(msg => msg._id === tempId ? finalizedMessage : msg)
      );
    } else {
      throw new Error(data.message || "Transmission failed");
    }
  } catch (err) {
    console.error("🔒 Agent transmission crypto block exception:", err);
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

    {/* B. IN-CHAT STATUS BAR */}
    {/* Displays mini-status controls once actively connecting or connected. */}
    {/* ✅ FIX: Stays hidden during 'calling' and 'ringing' states to avoid overlay mismatches */}
    {!showFullScreenCall && !['calling', 'ringing'].includes(callStatus) && (
      <div className="absolute top-0 left-0 w-full z-[150] animate-in slide-in-from-top duration-300">
        <div className={`h-[55px] md:h-[65px] flex items-center justify-between px-6 shadow-lg backdrop-blur-md transition-all duration-300 ${
          callStatus === 'connected' ? 'bg-green-500/95 text-white' : 'bg-blue-600/95 text-white'
        }`}>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:0.2s]" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.15em] leading-none">
                {callStatus === 'connected' ? 'Secure Link Established' : 'Establishing Secure Link...'}
              </span>
              {callStatus === 'connected' && (
                <div className="flex items-center gap-1.5 mt-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${isVoiceConversionActive ? 'bg-green-400 animate-pulse' : 'bg-blue-300 opacity-60'}`} />
                  <span className="text-[8px] font-black uppercase tracking-tighter opacity-90">
                    {isVoiceConversionActive ? 'AI Masking Active' : 'Natural Voice Mode'}
                  </span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end mr-2">
              <span className="text-xs font-mono font-bold">
                {callStatus === 'connected' ? formatTime(callTime) : 'SECURE...'}
              </span>
            </div>
            <button
              onClick={() => setShowFullScreenCall(true)}
              className="text-[9px] font-black border border-white/40 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-all active:scale-95 uppercase tracking-widest"
            >
              Expand
            </button>
          </div>
        </div>
      </div>
    )}


    {/* C. FULLSCREEN OVERLAY */}
    {/* Forces itself into view instantly if callStatus is 'ringing' or if expanded manually */}
    {(showFullScreenCall || callStatus === 'ringing') && (
      <div className="fixed inset-0 z-[40000] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center text-white animate-in fade-in zoom-in duration-300">
        <div className="flex flex-col items-center space-y-10 relative w-full max-w-lg">
          
          {/* Prevent agents from minimizing the modal overlay while an active call is ringing */}
          {callStatus !== 'ringing' && (
            <button
              onClick={() => setShowFullScreenCall(false)}
              className="absolute -top-16 right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 group active:scale-95 transition-all"
            >
              <BsChevronDown className="text-white/50 group-hover:text-white" size={20} />
            </button>
          )}
          
          {/* Caller Avatar */}
          <div className="w-44 h-44 rounded-[3rem] border-4 border-blue-500/20 p-1 relative shadow-2xl">
            <img
              src={isIncomingCall ? activeCaller?.photoUrl : (selectedUser?.photoUrl || "/default-avatar.png")}
              className="w-full h-full rounded-[2.8rem] object-cover"
              alt="Caller"
              onError={(e) => {
                e.currentTarget.onerror = null;
                const displayName = isIncomingCall ? activeCaller?.fromName : selectedUser?.firstName;
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || "User")}&background=0D1117&color=fff`;
              }}
            />
            {callStatus !== 'connected' && (
              <div className="absolute inset-0 w-full h-full bg-blue-500 rounded-[2.8rem] animate-ping opacity-20"></div>
            )}
          </div>

          <div className="text-center px-6">
            <h2 className="text-3xl md:text-4xl font-black tracking-tighter mb-2">
              {isIncomingCall ? (activeCaller?.fromName || "Incoming Call") : (selectedUser ? `${selectedUser.firstName} ${selectedUser.lastName}` : "Secure Line")}
            </h2>
            
            {/* Status Section */}
            <div className="flex flex-col items-center gap-4 mt-6">
              <p className="text-blue-400 font-black uppercase tracking-[0.5em] text-[10px] animate-pulse">
                {callStatus === 'ringing' 
                  ? "Incoming Secure Call..." 
                  : peerConnected 
                    ? "Connection Encrypted" 
                    : "Waiting for User to Accept..."}
              </p>

              {/* Consolidated Voice Mode Badge */}
              {callStatus === 'connected' && (
                <div className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-500 ${
                  isVoiceConversionActive 
                    ? 'bg-green-500/20 border-green-500/40 shadow-[0_0_20px_rgba(34,197,94,0.15)]' 
                    : 'bg-white/5 border-white/10'
                }`}>
                  {isVoiceConversionActive ? (
                    <>
                      <div className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </div>
                      <BsShieldLockFill size={12} className="text-green-500" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-green-400">
                        AI Voice Masking Active
                      </span>
                    </>
                  ) : (
                    <>
                      <BsMicFill size={12} className="text-blue-400 opacity-80" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200/70">
                        Standard Natural Mode
                      </span>
                    </>
                  )}
                </div>
              )}

              {callStatus === 'connected' && (
                <span className="text-white font-mono text-3xl font-light tracking-widest mt-2">{formatTime(callTime)}</span>
              )}
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-8 md:gap-12 mt-12">
            {isIncomingCall && callStatus === 'ringing' ? (
              <>
                <button onClick={handleEndCall} className="w-20 h-20 bg-red-500 rounded-2xl flex items-center justify-center shadow-2xl active:scale-90 transition-all z-[40001]">
                  <div className="rotate-[135deg]"><BsTelephoneFill size={32} color="white" /></div>
                </button>
                <button onClick={handleAcceptCall} className="w-20 h-20 bg-green-500 rounded-2xl flex items-center justify-center shadow-2xl animate-bounce active:scale-90 transition-all z-[40001]">
                  <BsTelephoneFill size={32} color="white" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${isMuted ? 'bg-red-500 shadow-red-500/20' : 'bg-white/10 hover:bg-white/20'}`}
                >
                  {isMuted ? <BsMicMuteFill size={24} color="white" /> : <BsMicFill size={24} color="white" />}
                </button>
                <button onClick={handleEndCall} className="w-20 h-20 bg-red-600 rounded-2xl flex items-center justify-center shadow-2xl active:scale-95 transition-all">
                  <div className="rotate-[135deg]"><BsTelephoneFill size={32} color="white" /></div>
                </button>
                <button 
                  onClick={() => setIsSpeakerOn(!isSpeakerOn)} 
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${isSpeakerOn ? 'bg-white text-slate-900' : 'bg-white/10 hover:bg-white/20'}`}
                >
                  <BsVolumeUpFill size={26} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
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

    {/* --- 1. GLOBAL LOADING STATE --- */}
{loading ? (
  <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-white">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
  </div>
) : isDualLoginConflict ? (
  /* --- 2. PRIORITY: SECURITY ALERT --- */
  <div className="fixed inset-0 z-[60000] bg-slate-900/98 backdrop-blur-xl flex items-center justify-center p-6">
    <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-12 text-center animate-in zoom-in duration-300">
      <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
        <BsShieldFillExclamation size={40} className="text-red-500 animate-pulse" />
      </div>
      <h2 className="text-2xl font-black uppercase tracking-tighter text-slate-900 mb-4">Security Alert</h2>
      <p className="text-slate-500 text-sm mb-8">Your account is active on another device.</p>
 <button 
  onClick={handleDisconnect}
  className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl uppercase tracking-widest text-[11px]"
>
  Disconnect Other Device
</button>
    </div>
  </div>

) : !isSubscribed && !showSuccessOverlay ? (
<div className="fixed inset-0 z-[10000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[95vh]">
      
      {/* Sidebar - Retained for Brand Context */}
      <div className="bg-blue-700 p-8 text-white md:w-1/3 flex flex-col justify-between">
        <div>
          <BsShieldLockFill size={28} className="mb-4 opacity-80" />
          <h2 className="text-2xl font-black uppercase tracking-tighter mb-2">Account Inactive</h2>
          <p className="text-blue-100 text-xs opacity-90 leading-relaxed">
            Choose a plan to continue accessing your dashboard and secure communications.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 md:p-8 bg-gray-50 flex flex-col overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-800 mb-6">Select Access Plan</h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {plans.map((plan) => (
            <div
              key={plan.tier}
              onClick={() => setSelectedPlan(plan.tier)}
              className={`cursor-pointer p-4 rounded-xl border-2 transition-all flex flex-col justify-between h-auto sm:h-40 ${
                selectedPlan === plan.tier 
                  ? 'border-blue-600 bg-blue-50 shadow-md' 
                  : 'border-gray-200 bg-white hover:border-blue-300'
              }`}
            >
              <div>
                <div className="flex justify-between items-start">
                  <span className={`text-[9px] font-black uppercase tracking-widest ${selectedPlan === plan.tier ? 'text-blue-600' : 'text-gray-400'}`}>
                    {plan.tier}
                  </span>
                  {plan.popular && (
                    <span className="bg-blue-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">POPULAR</span>
                  )}
                </div>
                <div className="text-lg font-black text-gray-900 mt-2">₦{plan.price}</div>
                <div className="text-[10px] font-semibold text-gray-400">{plan.term}</div>
              </div>

              {/* Feature List Preview - Added for Complexity */}
              <ul className="hidden sm:block mt-3 space-y-1">
                {plan.features.slice(0, 2).map((feat, i) => (
                  <li key={i} className="text-[9px] text-gray-500 truncate">• {feat}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <button 
          disabled={paymentProcessing} 
          onClick={handlePayment} 
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3.5 rounded-lg uppercase tracking-wider text-[11px] transition-all transform active:scale-[0.98]"
        >
          {paymentProcessing ? "Processing..." : `Activate ${selectedPlan} Access`}
        </button>
        
        <p className="text-[10px] text-gray-400 text-center mt-4">Secure payment powered by Flutterwave.</p>
      </div>
    </div>
  </div>
) : null}

    {/* --- SIDEBAR --- */}
    <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-[30%] lg:min-w-[350px] bg-card-bg flex-col z-[100]`}>
  <header className="h-[60px] bg-page-bg px-3 flex justify-between items-center  shrink-0">
   <button 
  onClick={() => navigate(`/agent/profile/${slug || agentData?.slug || ''}`)} 
  className="h-10 w-10 rounded-full hover:bg-input-bg flex items-center justify-center"
>
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
        <button 
          onClick={handleLogout} 
          className="w-full flex items-center justify-center gap-3 py-3 bg-white border border-red-100 text-red-500 rounded-xl hover:bg-red-50 transition-all active:scale-95"
        >
          <span className="text-[11px] font-black uppercase tracking-widest">Disconnect Session</span>
        </button>
      </div>
    </aside>

    {/* --- MAIN CHAT INTERFACE --- */}
<main className={`${!showSidebar ? 'flex' : 'hidden'} lg:flex flex-1 flex-col bg-page-bg relative overflow-hidden h-screen`}>
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
     {selectedUser.status === 'online' || selectedUser.isOnline ? (
  <p className="text-[11px] font-medium text-gray-500 lowercase leading-tight">
    {selectedUser.email}
  </p>
) : (
  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">
    {/* Updated to use selectedUser.lastActive and timeTicker */}
    Last seen: {formatLastSeen(selectedUser.lastActive || selectedUser.updatedAt, timeTicker)}
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
  <button 
    onClick={() => alert('Feature not available yet')} 
    className="hover:text-blue-600 transition-colors active:scale-90 p-2" 
    title="Call Settings"
  > 
    <BsGearFill size={20} />
  </button>
</div>
</header>

<div 
  ref={scrollRef} 
  onScroll={handleScroll} 
  className="flex-1 overflow-y-auto scroll-manual p-4 md:px-20 space-y-2 z-10 flex flex-col bg-page-bg dark:bg-slate-950/50"
>
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

  {/* --- ADVANCED HUMAN-CENTRIC USER METRIC MODAL --- */}
{showUserModal && selectedUser && (
  <div className="fixed inset-0 z-[50000] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-300">
    {/* High-Fidelity Backdrop Blur */}
    <div 
      className="fixed inset-0 bg-slate-950/40 backdrop-blur-md transition-opacity" 
      onClick={() => setShowUserModal(false)} 
    />

    {/* Adaptive Layout Container */}
    <div className="relative w-full max-w-2xl bg-slate-50/80 backdrop-blur-2xl rounded-[2.5rem] border border-white/70 shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in zoom-in-95 duration-200">
      <div className="relative w-full md:w-[240px] bg-gradient-to-b from-slate-900 to-slate-950 text-white p-6 flex flex-col items-center justify-between text-center border-b md:border-b-0 md:border-r border-slate-800/80">
        
        {/* Ambient Radial Spotlight Decor */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-blue-600/15 via-transparent to-transparent opacity-70 pointer-events-none" />

        <div className="relative w-full flex flex-col items-center z-10">
          {/* Square-Circle Profile Picture Casing */}
          <div className="relative mb-4 w-28 h-28 rounded-3xl overflow-hidden bg-slate-800 shadow-xl border border-white/10 group">
            <img 
              src={selectedUser.photoUrl} 
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
              alt={`${selectedUser.firstName || 'User'}'s Profile`} 
              onError={(e) => { 
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedUser.firstName || 'U')}&background=0D1117&color=fff&size=128`; 
              }}
            />
          </div>

          {/* Core Identification Text Headers */}
          <h3 className="text-lg font-black tracking-tight text-slate-100 leading-tight">
            {selectedUser.firstName || '—'} {selectedUser.lastName || ''}
          </h3>

          {/* Dynamic Badge Engine */}
          <span className={`inline-flex items-center gap-1.5 mt-2.5 px-3 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-wider ${
            selectedUser.isVerified 
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
              : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${selectedUser.isVerified ? 'bg-emerald-400' : 'bg-blue-400'}`} />
            {selectedUser.isVerified ? 'Verified Client' : 'Standard Client'}
          </span>
        </div>

        {/* Temporal Information Footers - Automatically hidden on tiny viewports */}
        <div className="relative w-full mt-6 pt-4 border-t border-slate-800/60 space-y-2.5 text-left z-10 hidden md:block">
          <div>
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Lifecycle Status</p>
            <p className="text-[10px] font-bold text-slate-300">
              {selectedUser.isProfileComplete ? 'Profile Active' : 'Pending Lifecycle Configuration'}
            </p>
          </div>
          {selectedUser.createdAt && (
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Creation Index</p>
              <p className="text-[10px] font-bold text-slate-400">
                {new Date(selectedUser.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          RIGHT COLUMN: PROFILE PARAMETERS GRID WORKSPACE
          ========================================================================= */}
      <div className="flex-1 p-6 md:p-8 flex flex-col justify-between">
        <div className="space-y-5">
          {/* Section Section Title Header */}
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Client Profile Parameters</h4>
            <div className="flex-1 h-px bg-slate-200/80" />
          </div>

          {/* Symmetric Grid Array */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            
            {/* Email Field - Spans full width for copy friendliness */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-sm flex flex-col justify-between sm:col-span-2 group hover:border-slate-300 transition-colors">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Email Address</p>
              <p className="text-xs font-bold text-slate-800 break-all select-all selection:bg-blue-100">{selectedUser.email || '—'}</p>
            </div>

            {/* Guarded Phone Field Wrapper */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-colors">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Phone Number</p>
              <p className="text-xs font-bold text-slate-800">
                {(() => {
                  const phoneData = selectedUser.phone || selectedUser.phoneNumber;
                  if (!phoneData) return 'No Phone Registered';
                  if (typeof phoneData === 'object') {
                    return phoneData.formatted || phoneData.raw || 'No Phone Registered';
                  }
                  return String(phoneData);
                })()}
              </p>
            </div>

           {/* Explicit Gender Identity Data Frame */}
<div className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-colors">
  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Gender Identity</p>
  <p className={`text-xs font-bold capitalize ${
    !selectedUser.gender || selectedUser.gender.toLowerCase() === 'not specified' 
      ? 'text-slate-400 italic font-medium' 
      : 'text-slate-800'
  }`}>
    {selectedUser.gender && selectedUser.gender.toLowerCase() !== 'not specified' 
      ? selectedUser.gender 
      : 'Not Specified'}
  </p>
</div>

            {/* Geographical Mapping Array */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-sm flex flex-col justify-between sm:col-span-2 hover:border-slate-300 transition-colors">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Geographical Parameters</p>
              <div className="text-xs font-bold text-slate-800 leading-relaxed">
                {selectedUser.address && <p className="text-slate-600 font-medium mb-1">{selectedUser.address}</p>}
                {(selectedUser.city || selectedUser.state) ? (
                  <p className="text-blue-600 font-black">
                    {[selectedUser.city, selectedUser.state].filter(Boolean).join(', ')}
                  </p>
                ) : (
                  !selectedUser.address && <p className="text-slate-400 font-medium italic">No Location Context Found</p>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Modal Dismiss Action Bar */}
        <div className="mt-8 pt-4 border-t border-slate-200/80 flex items-center justify-end">
          <button 
            onClick={() => setShowUserModal(false)}
            className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-md shadow-slate-900/10 transition-all duration-150"
          >
            Dismiss Profile View
          </button>
        </div>
      </div>

    </div>
  </div>
)}
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