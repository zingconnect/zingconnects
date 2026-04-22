import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { motion, useAnimation } from "framer-motion";
import { useDrag } from "@use-gesture/react";
import { BsReplyFill } from "react-icons/bs";
import { 
  BsTelephoneFill, 
  BsPlusLg, 
  BsSendFill, 
  BsCheckAll,
  BsChevronLeft, // Kept this one
  BsShieldLockFill,
  BsGearFill,
  BsArrowRight,
  BsCameraFill,
  BsMicFill,   
  BsVolumeUpFill, // Added for Speaker
  BsMicMuteFill,   
  BsPaperclip,
  BsDownload,    // Now properly imported
  BsPlayFill     // Now properly imported
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

const CallStatusMessage = ({ status, time }) => (
  <div className="flex justify-center my-4 w-full z-10">
    <div className="bg-[#1f2c33] rounded-xl px-4 py-3 flex items-center gap-3 min-w-[220px] border border-white/10 shadow-xl">
      <div className="bg-slate-700 p-2 rounded-full">
        <BsTelephoneFill className="text-green-500" size={16} />
      </div>
      <div className="flex-1">
        <h4 className="text-white text-[13px] font-semibold">Voice call</h4>
        <div className="text-gray-400 text-[11px] capitalize flex items-center gap-1.5">
          {status === 'ringing' ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span>Ringing...</span>
            </>
          ) : (
            <span className={status === 'missed' ? 'text-red-400' : ''}>{status}</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-gray-500 mt-auto ml-2">{time}</span>
    </div>
  </div>
);

export const UserDashboard = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // 1. FIRST: Define ALL your states (move the call states up here)
  const [agent, setAgent] = useState(null);
  const [userData, setUserData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [onboardingFile, setOnboardingFile] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [caption, setCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('online');
  const [replyingTo, setReplyingTo] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  // MOVE THESE UP:
  const [callStatus, setCallStatus] = useState('idle'); 
  const [activeCall, setActiveCall] = useState(null); // Now initialized!
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    city: '',
    state: ''
  });
  const isIncomingCall = activeCall?.callerData ? true : false;
  console.log("Current connection:", connectionStatus);
  console.log("Is there an incoming call?", isIncomingCall);
  const ringtoneRef = useRef(new Audio('/sounds/ringtone.mp3'));
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));
  const lastNotifiedId = useRef(null);

  // --- HELPERS ---
  const getStatusInfo = (agentData) => {
    if (!agentData) return { isOnline: false, label: "Connecting..." };
    if (agentData.status === 'online') return { isOnline: true, label: "Online" };
    if (agentData.lastSeenText) return { isOnline: false, label: agentData.lastSeenText };
    if (agentData.lastActive) {
      const diff = Math.floor((new Date() - new Date(agentData.lastActive)) / 1000);
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

useEffect(() => {
  if (!socket || !userData?._id) return;

  socket.emit("join-main-room", userData._id);

  const handleIncomingCall = (data) => {
    // 1. WhatsApp Logic: If we receive the signal, we tell the sender we are 'ringing'
    socket.emit("confirm-ringing", { to: data.fromId });
    
    if (callStatus === 'idle') {
      setActiveCall({
        callId: data.callId,
        fromId: data.fromId,
        callerData: {
          fromName: data.fromName,
          photoUrl: data.photoUrl,
          callerId: data.fromId
        }
      });
      setCallStatus('ringing');
    }
  };

  const handleCallEnded = () => {
    setCallStatus('idle');
    setActiveCall(null);
  };

  socket.on("incoming-call", handleIncomingCall);
  socket.on("call-ended", handleCallEnded);
  
  return () => {
    socket.off("incoming-call", handleIncomingCall);
    socket.off("call-ended", handleCallEnded);
  };
}, [userData?._id, callStatus, socket]);


useEffect(() => {
  const token = localStorage.getItem('userToken');
  if (!token) return;

  const checkCalls = async () => {
    // If we are already in a conversation, don't poll
    if (callStatus === 'connected') return;

    try {
      const response = await fetch('/api/calls/check-incoming', {
        headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' }
      });
      const data = await response.json();

      if (data.hasIncomingCall) {
        // If we were IDLE, we just discovered a new call
        if (callStatus === 'idle') {
          setActiveCall({
            callId: data.callId,
            callerData: data.callerData,
            fromId: data.callerData.callerId
          });
          setCallStatus('ringing');
          socket.emit("confirm-ringing", { to: data.callerData.callerId });
        }
      } else {
        // If the DB says no call, but we are ringing, the caller cancelled
        if (callStatus === 'ringing') {
          setCallStatus('idle');
          setActiveCall(null);
        }
      }
    } catch (err) {
      console.warn("Polling error:", err);
    }
  };

  const interval = setInterval(checkCalls, 3000);
  return () => clearInterval(interval);
}, [callStatus, socket]);

useEffect(() => {
  const audio = ringtoneRef.current;
  
  if (callStatus === 'ringing' && isIncomingCall) {
    audio.loop = true;
    audio.play().catch(() => {});
  } else {
    audio.pause();
    audio.currentTime = 0;
  }
    if (callStatus === 'calling') {
  }
  return () => {
    audio.pause();
    audio.currentTime = 0;
  };
}, [callStatus, isIncomingCall]);

useEffect(() => {
  const remoteMedia = document.getElementById('remoteAudio'); 
  
  if (remoteMedia) {
    remoteMedia.volume = isSpeakerOn ? 1.0 : 0.3; 
  }
}, [isSpeakerOn]);

const toggleMute = () => {
  setIsMuted(prev => {
    const newState = !prev;
    
    // This is the part that actually cuts the microphone audio
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !newState; 
      });
    }
    
    return newState;
  });
};

const handleAcceptCall = async () => {
  const token = localStorage.getItem('userToken');
  
  // 1. Immediate UI/UX Feedback
  if (ringtoneRef.current) {
    ringtoneRef.current.pause();
    ringtoneRef.current.currentTime = 0;
  }
  
  try {
    const res = await fetch('/api/calls/accept', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ callId: activeCall?.callId }) 
    });
    
    if (res.ok) {
      setCallStatus('connected');
      setIsIncomingCall(false); // Hide the "Drop Modal" once answered
      setMessages(prev => prev.map(m => 
        m.fileType === 'voice_call' && m.status === 'ringing' 
          ? { ...m, status: 'connected' } 
          : m
      ));
      socket.emit("answer-call", {
        to: activeCaller?.fromId, // Use the activeCaller state we set earlier
        callId: activeCall?.callId,
        signal: null // Replace with your WebRTC signal data if using peer-to-peer
      });
    }
  } catch (err) {
    console.error("Failed to accept call", err);
    setCallStatus('idle');
  }
};

const handleEndCall = async () => {
  const token = localStorage.getItem('userToken');
  setCallStatus('idle'); // Set UI to idle immediately for responsiveness
  setActiveCall(null);
  
  try {
    await fetch('/api/calls/end', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json' 
      }
    });
  } catch (err) {
    console.error("Failed to end call", err);
  }
};

useEffect(() => {
  const setupNotifications = async () => {
    try {
      const publicKey = import.meta.env.VITE_PUBLIC_KEY;
      if (!publicKey) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      
      // Get existing or create new
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      const token = localStorage.getItem('userToken'); 
      if (!token) return;

      // ALWAYS send it to the backend to ensure the DB is synced
      const response = await fetch('/api/save-subscription', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
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
    // Timeout ensures the DOM has rendered the new message before scrolling
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages]);

  // --- HOOK 1: SESSION & ONBOARDING ---
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    if (!token) return navigate('/');

    const fetchUserSession = async () => {
  try {
    const response = await fetch('/api/users/my-session', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    
    if (response.ok) {
      setAgent(data.agent); 
      setUserData(data.user); 
      
      if (!data.user.isProfileComplete) {
        setShowOnboarding(true);
      }
    }
  } catch (err) {
    console.error("Session fetch error:", err);
  } finally {
    setLoading(false);
  }
};

    fetchUserSession();
    const interval = setInterval(fetchUserSession, 30000); 
    return () => clearInterval(interval);
  }, [navigate]);

  useEffect(() => {
  const token = localStorage.getItem('userToken');
  if (!token || !agent?._id) return;

 const fetchMessages = async () => {
    try {
      const response = await fetch(`/api/messages/${agent._id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (response.ok && data.success) {
        const incomingMessages = data.messages;
        const lastMsg = incomingMessages[incomingMessages.length - 1];

        if (
          lastMsg && 
          lastMsg.senderModel === 'Agent' && 
          lastMsg.status !== 'seen' && 
          lastMsg._id !== lastNotifiedId.current // Check against the Ref
        ) {
          lastNotifiedId.current = lastMsg._id;
          if (notificationSound.current) {
            notificationSound.current.currentTime = 0;
            notificationSound.current.play().catch(() => console.log("Audio blocked by browser"));
          }

          // Browser Notification (Branding Fix)
          if (Notification.permission === "granted") {
            new Notification(`Agent ${agent.firstName}`, {
              body: lastMsg.text || "Sent a file",
              icon: '/logo-s.png', // Point to your brand logo in public folder
              tag: 'zing-msg'    // Grouping tag to prevent spam
            });
          }

          // Mark as Read (Silent Background update)
          fetch(`/api/messages/mark-read/${agent._id}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` }
          }).catch(err => console.error("Mark read failed:", err));
        }

        // --- 2. STATE UPDATE (STABILITY) ---
        setMessages(prev => {
          // Only re-render if the number of messages actually changed
          if (prev.length !== incomingMessages.length) {
            return incomingMessages;
          }
          return prev;
        });
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  };

  fetchMessages();
  const interval = setInterval(fetchMessages, 5000); 
  return () => clearInterval(interval);
}, [agent?._id]);

  const agentStatus = getStatusInfo(agent);

  const handlePhotoClick = () => fileInputRef.current.click();

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

const handleSendWithPreview = async () => {
  if (!selectedFile || isUploading) return;
  setIsUploading(true);

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);
    
    const uploadRes = await axios.post('/api/upload', formData);
    const { fileUrl, fileType } = uploadRes.data;
    const payload = {
      receiverId: selectedUser._id,
      text: caption.trim(), // The caption typed in the preview
      fileUrl: fileUrl,
      fileType: fileType,
      senderModel: 'User' // or 'User' depending on the dashboard
    };
    socket.emit('sendMessage', payload);
    setPreviewUrl(null);
    setSelectedFile(null);
    setCaption("");
  } catch (error) {
    console.error("Failed to send media:", error);
  } finally {
    setIsUploading(false);
  }
};
const handleProfileSubmit = async (e) => {
  e.preventDefault();
  const token = localStorage.getItem('userToken');
  const data = new FormData();
  
  // FAIL-SAFE: Check both potential file states to ensure 'photo' isn't empty
  const fileToUpload = onboardingFile || previewFile;

  if (fileToUpload) {
    // This MUST match the backend upload.single('photo')
    data.append('photo', fileToUpload);
    console.log("Appending file to upload:", fileToUpload.name);
  } else {
    console.warn("No file detected in onboardingFile or previewFile state.");
  }
  data.append('firstName', formData.firstName);
  data.append('lastName', formData.lastName);
  data.append('dob', formData.dob);
  data.append('gender', formData.gender);
  data.append('city', formData.city);
  data.append('state', formData.state);

  try {
    const res = await fetch('/api/users/update-user-onboarding', {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}` 
      },
      body: data
    });

    const result = await res.json();

    if (res.ok) {
      if (setUserData) setUserData(result.user);
      
      // 2. Clear UI states
      setShowOnboarding(false);
      setOnboardingFile(null);
      setPreviewFile(null);
      setPreviewUrl(null);
      
      console.log("Profile updated successfully:", result.user.photoUrl);
    } else {
      console.error("Server update failed:", result.message);
    }
  } catch (err) {
    console.error("Profile initialization failed:", err);
  }
};

const unlockAudio = () => {
  if (notificationSound.current) {
    notificationSound.current.play()
      .then(() => {
        notificationSound.current.pause();
        notificationSound.current.currentTime = 0;
        setHasInteracted(true); 
        if (socket && agent?._id) {
          socket.emit("join-private-room", agent._id);
          console.log("Socket room joined after audio unlock");
        }
        console.log("Audio and Socket session unlocked successfully");
      })
      .catch(p => {
        console.error("Audio unlock failed. User gesture required:", p);
      });
  } else {
    // Fallback if the ref isn't loaded yet
    setHasInteracted(true);
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
    alert(`This ${detectedType} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum allowed is 100MB.`);
    e.target.value = null; 
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }

  // Set State for the WhatsApp-style preview overlay
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
  const savedFile = previewFile; // Keep a reference for resending
  const savedCaption = caption;

  // Optimistic UI for Media
  const pendingMedia = {
    _id: tempId,
    senderId: userData._id,
    text: savedCaption,
    fileUrl: previewUrl, // Use the local blob URL for preview
    fileType: detectedType,
    status: 'sending',
    createdAt: new Date().toISOString(),
    isTemp: true,
    originalFile: savedFile // Store file in object for resending
  };

  setMessages(prev => [...prev, pendingMedia]);
  setPreviewUrl(null); // Close the preview overlay
  setPreviewFile(null);

  setIsUploading(true);
  const token = localStorage.getItem('userToken'); 

  try {
    const urlResponse = await fetch('/api/messages/get-upload-url', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
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
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
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

const handleStartCall = async () => {
  if (!agent?._id) return;
  const token = localStorage.getItem('userToken'); 
  setCallStatus('calling'); 
  
  try {
    const res = await fetch('/api/calls/start', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        receiverId: agent._id,
        receiverModel: 'Agent' 
      })
    });
    
    const data = await res.json();
    if (data.success) {
      setActiveCall({ callId: data.callId });
            socket.emit("call-user", {
        userToCall: agent._id,
        fromId: userData?._id,
        fromName: `${userData?.firstName} ${userData?.lastName}`,
        callId: data.callId
      });
    } else {
      setCallStatus('idle');
      alert("Agent is unavailable.");
    }
  } catch (err) {
    setCallStatus('idle');
    console.error("Network Error:", err);
  }
};


 const handleSendMessage = async (e) => {
  e.preventDefault();
  if (!newMessage.trim() || !agent?._id) return;
  
  const textToSend = newMessage;
  const tempId = Date.now().toString(); // Temporary ID for UI tracking
  setNewMessage(''); 

  const pendingMessage = {
    _id: tempId,
    senderId: userData._id,
    text: textToSend,
    status: 'sending', // Custom status for the UI
    createdAt: new Date().toISOString(),
    isTemp: true
  };
  setMessages(prev => [...prev, pendingMessage]);

  try {
    const token = localStorage.getItem('userToken');
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        receiverId: agent._id,
        text: textToSend,
        fileType: 'text',
        replyToId: replyingTo?._id 
      })
    });

    const data = await response.json();
    if (data.success) {
      setMessages(prev => prev.map(m => m._id === tempId ? data.message : m));
    } else {
      throw new Error("Failed to save");
    }
  } catch (err) {
    console.error("Message failed to send:", err);
    setMessages(prev => prev.map(m => 
      m._id === tempId ? { ...m, status: 'failed' } : m
    ));
  }
};

const handleResend = (msg) => {
  setMessages(prev => prev.filter(m => m._id !== msg._id));
  if (msg.fileType === 'image' || msg.fileType === 'video') {
    // Re-set the preview states and trigger the media flow
    setPreviewFile(msg.originalFile);
    setPreviewUrl(msg.fileUrl);
    setCaption(msg.text);
  } else {
    // Directly re-send text
    setNewMessage(msg.text);
    // You can manually call your send logic here
  }
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


  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#f0f2f5] text-[10px] font-black uppercase tracking-[0.2em] text-blue-900">
      Securing Connection...
    </div>
  );

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
        
        <main className="flex-1 p-6 flex flex-col items-center text-center space-y-5 overflow-y-auto scrollbar-hide pb-10">
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
      {showOnboarding && (
        <div className="absolute inset-0 z-[100] bg-white flex flex-col items-center justify-center p-4 md:p-8 animate-in fade-in zoom-in duration-300">
          <div className="w-full max-w-sm md:max-w-md space-y-4 md:space-y-6">
            <div className="text-center space-y-1">
              <h2 className="text-lg md:text-2xl font-black text-blue-900 uppercase leading-none">Initialize Profile</h2>
              <p className="text-[9px] md:text-xs text-gray-400 font-bold uppercase tracking-[0.15em]">Secure verification required</p>
            </div>

           <form onSubmit={handleProfileSubmit} className="space-y-3 md:space-y-4">
        <div className="flex flex-col items-center mb-4">
          {/* FIX: This input now uses the updated handleFileChange 
              which checks 'showOnboarding' to decide where to save the file.
          */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            className="hidden" 
          />
          <div 
            onClick={handlePhotoClick} 
            className="w-16 h-16 md:w-20 md:h-20 bg-gray-100 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 relative cursor-pointer hover:border-blue-400 transition-colors overflow-hidden"
          >
             {/* Uses previewUrl for visual feedback without triggering the chat preview overlay */}
             {previewUrl ? (
               <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
             ) : (
               <BsCameraFill size={20} />
             )}
             
             {!previewUrl && (
               <span className="absolute -bottom-1 bg-blue-600 text-white text-[8px] px-2 py-0.5 rounded-full font-bold uppercase">
                 Add Photo
               </span>
             )}
          </div>
        </div>

              <div className="grid grid-cols-2 gap-2 md:gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">First Name</label>
                  <input required className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none" placeholder="First" onChange={e => setFormData({...formData, firstName: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Last Name</label>
                  <input required className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none" placeholder="Last" onChange={e => setFormData({...formData, lastName: e.target.value})} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 md:gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Date of Birth</label>
                  <input required type="date" className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none" onChange={e => setFormData({...formData, dob: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Gender</label>
                  <select 
                    required 
                    className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none appearance-none"
                    onChange={e => setFormData({...formData, gender: e.target.value})}
                    value={formData.gender}
                  >
                    <option value="" disabled>Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 md:gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">City</label>
                  <input required className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none" placeholder="City" onChange={e => setFormData({...formData, city: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">State</label>
                  <input required className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none" placeholder="State" onChange={e => setFormData({...formData, state: e.target.value})} />
                </div>
              </div>

              <button type="submit" className="w-full bg-blue-600 text-white p-3 md:p-4 rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest hover:bg-blue-700 active:scale-95 transition-all shadow-lg shadow-blue-100 mt-2">
                Launch Dashboard
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
  <BsTelephoneFill 
    className="cursor-pointer hover:text-blue-600 transition-colors active:scale-90" 
    size={16} 
    onClick={handleStartCall} // <--- Added this
  />
  <BsGearFill className="cursor-pointer hover:text-gray-700 transition-colors" size={18} />
</div>
        </header>

        <main className="flex-1 relative overflow-y-auto bg-[#efeae2] p-4 md:px-[15%] lg:px-[25%] flex flex-col space-y-2 scrollbar-hide">
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
  // Safe key generation for messages that don't have a DB _id yet
  const msgKey = m._id || m.id || `temp-${m.createdAt}-${Math.random()}`;

  if (m.fileType === 'voice_call') {
    return (
      <CallStatusMessage 
        key={msgKey}
        status={m.status} // 'ringing', 'missed', 'ended'
        time={new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      />
    );
  }

  return (
    <div 
      key={msgKey} 
      className={`max-w-[85%] md:max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm relative z-10 animate-in fade-in slide-in-from-bottom-2 flex flex-col ${
        m.senderModel === 'User' ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
      } mb-3`}
    >
      {/* Media Handling (Image/Video) */}
      {(m.fileType === 'image' || m.fileType === 'video') && (
        <div className="relative mb-2 mt-1 group">
          {m.fileType === 'image' ? (
            <>
              <img 
                src={m.fileUrl} 
                alt="attachment" 
                onClick={() => setFullscreenImage(m.fileUrl)} 
                className="rounded-lg bg-gray-100 object-cover w-full max-w-[260px] max-h-[300px] md:max-w-[380px] md:max-h-[450px] cursor-pointer transition-opacity hover:opacity-95" 
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = 'https://via.placeholder.com/150?text=Image+Unavailable';
                }}
              />
              <button 
                onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'image'); }}
                className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
              >
                <BsDownload size={14} />
              </button>
            </>
          ) : (
            <div className="relative">
              <video 
                className="rounded-lg w-full max-w-[260px] md:max-w-[380px] max-h-[450px] bg-black shadow-inner cursor-pointer"
                onClick={() => setFullscreenVideo(m.fileUrl)}
              >
                <source src={m.fileUrl} type="video/mp4" />
              </video>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/40 p-3 rounded-full text-white backdrop-blur-sm">
                  <BsPlayFill size={30} />
                </div>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'video'); }}
                className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-20"
              >
                <BsDownload size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Text Content (Caption) */}
      {m.text && (
        <p className={`text-[12px] md:text-[14px] leading-relaxed pr-6 break-words ${m.fileType === 'image' || m.fileType === 'video' ? 'mt-1 mb-1' : ''}`}>
          {m.text}
        </p>
      )}

      {/* Time / Status Bar */}
      <div className="flex items-center justify-end gap-1 mt-1 border-t border-black/5 pt-0.5 min-w-[70px]">
        <span className="text-[9px] text-gray-400 font-bold uppercase">
          {new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>

        {/* WhatsApp Reliability Logic: Only show for User messages */}
        {m.senderModel === 'User' && (
          <div className="flex items-center ml-1">
            
            {/* 1. SENDING STATE (Network Active) */}
            {m.status === 'sending' && (
              <div className="w-2.5 h-2.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            )}

            {/* 2. FAILED STATE (Bad Network) */}
            {m.status === 'failed' && (
              <button 
                onClick={(e) => { e.stopPropagation(); handleResend(m); }}
                className="flex items-center bg-red-500 text-white px-1.5 py-0.5 rounded shadow-sm hover:bg-red-600 active:scale-95 transition-all"
              >
                <span className="text-[8px] font-black mr-1 uppercase">Retry</span>
                <BsPlusLg className="rotate-45" size={10} />
              </button>
            )}

            {/* 3. SUCCESS STATE (Checkmarks) */}
            {(!m.status || m.status === 'sent' || m.status === 'seen') && (
              <div className="flex items-center">
                {m.status === 'seen' ? (
                  <BsCheckAll className="text-blue-500" size={16} title="Read" />
                ) : (
                  <BsCheckAll className="text-gray-400" size={16} title="Sent" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
})}

{/* 4. THE FIX: Scroll Anchor */}
{/* Increased height to ensure the keyboard doesn't hide the last message */}
<div ref={messagesEndRef} className="h-12 shrink-0 w-full clear-both" />
</main>
{/* --- UPDATED WHATSAPP PREVIEW FOR USER DASHBOARD --- */}
{previewUrl && !showOnboarding && (
    <div className="absolute inset-0 z-[500] bg-black/90 flex flex-col animate-in fade-in zoom-in duration-200">
    {/* Header */}
    <div className="p-4 flex justify-between items-center text-white">
      <button 
        onClick={() => { 
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
          src={previewUrl} 
          controls 
          autoPlay 
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
  {/* --- REPLY PREVIEW PANEL --- */}
  {replyingTo && (
    <div className="px-2 md:px-6 pt-2">
      <div className="bg-white/60 backdrop-blur-sm rounded-t-2xl border-l-4 border-blue-600 flex items-center justify-between overflow-hidden shadow-sm animate-in slide-in-from-bottom-2 duration-200">
        <div className="p-3 flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-600 truncate">
              Replying to {replyingTo.senderModel === 'User' ? 'You' : `${agent?.firstName || 'Agent'}`}
            </p>
          </div>
          <p className="text-[13px] text-slate-600 truncate mt-0.5 leading-tight">
            {replyingTo.fileType === 'image' ? (
              <span className="flex items-center gap-1"><BsCameraFill size={12}/> Photo</span>
            ) : replyingTo.fileType === 'video' ? (
              <span className="flex items-center gap-1"><BsPlayFill size={14}/> Video</span>
            ) : (
              replyingTo.text
            )}
          </p>
        </div>

        {/* Thumbnail Preview if the replied message is Media */}
        {replyingTo.fileUrl && (
          <div className="w-12 h-12 bg-gray-200">
            {replyingTo.fileType === 'image' ? (
              <img src={replyingTo.fileUrl} className="w-full h-full object-cover opacity-80" alt="reply-thumb" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
                <BsPlayFill size={20} />
              </div>
            )}
          </div>
        )}

        {/* Cancel Reply Button */}
        <button 
          onClick={() => setReplyingTo(null)}
          className="p-3 text-slate-400 hover:text-blue-600 transition-colors"
        >
          <BsPlusLg className="rotate-45" size={18} />
        </button>
      </div>
    </div>
  )}

  {/* --- MAIN INPUT CONTROLS --- */}
  <div className="px-2 md:px-6 py-3 flex items-center gap-2 md:gap-3">
    {/* Hidden Inputs for File and Camera */}
    <input 
      type="file" 
      ref={fileInputRef} 
      onChange={handleFileUpload} 
      accept="image/*,video/*" 
      className="hidden" 
    />
    <input 
      type="file" 
      ref={cameraInputRef} 
      onChange={handleFileUpload} 
      accept="image/*,video/*" 
      capture="environment" 
      className="hidden" 
    />

    <div className="flex gap-1 md:gap-2 text-gray-500">
      {/* Attachment Button */}
      <button 
        type="button"
        onClick={() => fileInputRef.current.click()} 
        disabled={isUploading}
        className="p-2 hover:bg-black/5 rounded-full transition-colors active:scale-90"
      >
        <BsPaperclip size={22} />
      </button>

      {/* Camera Button */}
      <button 
        type="button"
        onClick={() => cameraInputRef.current.click()} 
        disabled={isUploading}
        className="p-2 hover:bg-black/5 rounded-full transition-colors active:scale-90"
      >
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
      
      {/* Voice/Send Toggle */}
      {newMessage.trim() ? (
        <button 
          type="submit" 
          className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform shrink-0"
        >
          <BsSendFill size={16} className="ml-0.5" />
        </button>
      ) : (
        <button 
          type="button"
          className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white text-gray-500 border border-gray-100 flex items-center justify-center hover:text-blue-600 transition-colors shrink-0"
        >
          <BsMicFill size={20} />
        </button>
      )}
    </form>
  </div>
</footer>
      </div>

      {!hasInteracted && (
        <button 
          onClick={unlockAudio} 
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
        >
          <div className="bg-white p-8 rounded-3xl shadow-2xl text-center space-y-4 max-w-xs border border-blue-100">
             <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
               <BsShieldLockFill className="text-blue-600" size={28} />
             </div>
             <h2 className="text-xl font-black text-blue-950">Security Sync</h2>
             <p className="text-gray-500 text-sm font-semibold leading-relaxed">
               Tap to authenticate your session and enable secure message alerts.
             </p>
             <div className="bg-blue-600 text-white py-3 px-8 rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-blue-200">
               SYNC & ENTER
             </div>
          </div>
        </button>
      )}

      {/* --- FULLSCREEN IMAGE OVERLAY (LIGHTBOX) --- */}
{fullscreenImage && (
  <div 
    className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-200"
    onClick={() => setFullscreenImage(null)}
  >
    <button className="absolute top-6 right-6 text-white/70 hover:text-white">
      <BsChevronLeft size={30} className="rotate-180" /> {/* Close Icon */}
    </button>
    <img 
      src={fullscreenImage} 
      className="max-w-full max-h-full object-contain shadow-2xl" 
      alt="Full view" 
    />
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
{/* --- UPDATED CALL OVERLAY --- */}
{callStatus !== 'idle' && (
  <div className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
    <div className="flex flex-col items-center space-y-10 animate-in zoom-in duration-500">
      
      {/* 1. AVATAR & PULSE */}
      <div className="relative">
        <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-4 border-blue-500/30 p-1 relative z-10">
          <img 
            src={activeCall?.callerData?.photoUrl || agent?.photoUrl || "/default-agent.png"} 
            className="w-full h-full rounded-full object-cover shadow-2xl"
            alt="Caller"
          />
        </div>
        {/* Animated Rings for 'Ringing' or 'Calling' */}
        {(callStatus === 'ringing' || callStatus === 'calling') && (
          <>
            <div className="absolute inset-0 w-full h-full bg-blue-500 rounded-full animate-ping opacity-20"></div>
            <div className="absolute -inset-4 border border-blue-500/10 rounded-full animate-pulse"></div>
          </>
        )}
      </div>

      {/* 2. IDENTITY & ENCRYPTION STATUS */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight">
          {activeCall?.callerData?.fromName || `${agent?.firstName} ${agent?.lastName}`}
        </h2>
        
        <div className="flex items-center justify-center gap-2">
          {callStatus === 'connected' && <BsShieldLockFill className="text-green-500" size={12} />}
          <p className={`text-[10px] font-black uppercase tracking-[0.3em] italic ${
            callStatus === 'connected' ? 'text-green-400' : 'text-blue-400'
          }`}>
            {callStatus === 'ringing' && (activeCall?.callerData ? "Incoming Secure Call" : "Calling Agent...")}
            {callStatus === 'connecting' && "Establishing Peer Link..."}
            {callStatus === 'connected' && "End-to-End Encrypted"}
            {callStatus === 'busy' && "Agent Unavailable"} 
          </p>
        </div>
      </div>

      {/* 3. DYNAMIC CONTROL INTERFACE */}
      <div className="flex items-center gap-8 md:gap-12 mt-12">
        
        {/* State A: INCOMING CALL (Ringing) */}
        {callStatus === 'ringing' && activeCall?.callerData ? (
          <div className="flex items-center gap-10">
            <div className="flex flex-col items-center gap-3">
              <button onClick={handleEndCall} className="w-16 h-16 md:w-20 md:h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 shadow-xl shadow-red-500/20 active:scale-90 transition-all">
                <BsTelephoneFill className="rotate-[135deg] text-white" size={28} />
              </button>
              <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Decline</span>
            </div>

            <div className="flex flex-col items-center gap-3">
              <button onClick={handleAcceptCall} className="w-16 h-16 md:w-20 md:h-20 bg-green-500 rounded-full flex items-center justify-center animate-bounce hover:bg-green-600 shadow-xl shadow-green-500/40 active:scale-95 transition-all">
                <BsTelephoneFill className="text-white" size={28} />
              </button>
              <span className="text-[9px] font-bold uppercase tracking-widest text-green-400">Accept</span>
            </div>
          </div>
        ) : (
          /* State B: CONNECTED or OUTGOING */
          <>
            {/* Speaker Toggle */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={() => setIsSpeakerOn(!isSpeakerOn)} 
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                  isSpeakerOn ? 'bg-white text-blue-600' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <BsVolumeUpFill size={24} />
              </button>
              <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Speaker</span>
            </div>

            {/* Global End Call Button */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={handleEndCall} 
                className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 shadow-2xl shadow-red-500/50 active:scale-90 transition-transform"
              >
                <BsTelephoneFill className="rotate-[135deg] text-white" size={32} />
              </button>
              <span className="text-[9px] font-bold uppercase tracking-widest text-red-500">End</span>
            </div>

            {/* Mute Toggle */}
            <div className="flex flex-col items-center gap-3">
              <button 
                onClick={toggleMute} 
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                  isMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                {isMuted ? <BsMicMuteFill size={24} /> : <BsMicFill size={24} />}
              </button>
              <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                {isMuted ? "Unmuted" : "Muted"}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Connection Info Tag */}
      {callStatus === 'connected' && (
        <div className="mt-8 px-4 py-1 bg-white/5 rounded-full border border-white/10">
           <p className="text-[8px] font-bold tracking-[0.2em] text-white/40 uppercase">Secure Node Protocol v4.2</p>
        </div>
      )}
    </div>
  </div>
)}

// Add this inside your return() at the very top level
{callStatus === 'ringing' && isIncomingCall && (
  <div className="fixed top-4 left-0 right-0 z-[9999] flex justify-center px-4">
    <div className="bg-[#1f2c33] w-full max-w-md rounded-2xl p-4 shadow-2xl border border-white/10 flex items-center justify-between animate-in slide-in-from-top duration-300">
      <div className="flex items-center gap-3">
        <img 
          src={activeCaller?.photoUrl || '/default-avatar.png'} 
          className="w-12 h-12 rounded-full object-cover border-2 border-green-500"
          alt="caller"
        />
        <div>
          <h3 className="text-white font-bold text-sm">{activeCaller?.fromName}</h3>
          <p className="text-gray-400 text-xs animate-pulse">Incoming voice call...</p>
        </div>
      </div>
      
      <div className="flex gap-2">
        <button 
          onClick={handleEndCall}
          className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
        >
          Decline
        </button>
        <button 
          onClick={handleAcceptCall}
          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
        >
          Answer
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
};