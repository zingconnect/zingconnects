import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'simple-peer/simplepeer.min.js'; // Using the minified version is more stable in Vite
import { Buffer } from 'buffer'; // Add this import here too

import { 
  BsSearch, 
  BsThreeDotsVertical, 
  BsCheckAll,
  BsCheck,
  BsPersonCircle,
  BsChevronLeft,
  BsShieldLockFill,
  BsCreditCard2BackFill,
  BsCheckCircleFill,
  BsDownload, 
  BsPlayFill, 
  BsTelephoneFill,    // Ensure this is here
  BsTelephoneXFill,   // Ensure this is here
  BsMicMuteFill       // Ensure this is here
} from 'react-icons/bs';

// --- POLYFILLS MUST BE FIRST ---
window.global = window;
window.process = { env: {} };
window.Buffer = Buffer;

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
  
  // --- STATE ---
  const messagesEndRef = useRef(null);
  const connectionRef = useRef();
  const scrollRef = useRef(null);
  const notificationSound = useRef(new Audio('/sounds/notification.mp3'));  
  const ringtoneRef = useRef(new Audio('/sounds/ringtone.mp3'));
  const lastNotifiedId = useRef(null);
const fileInputRef = useRef(null);
const cameraInputRef = useRef(null);

  const [agentData, setAgentData] = useState(null);
  const [users, setUsers] = useState([]); 
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [fullscreenImage, setFullscreenImage] = useState(null);
const [fullscreenVideo, setFullscreenVideo] = useState(null);
const [limit, setLimit] = useState(30); // Start with 30 messages
const [isInitialLoad, setIsInitialLoad] = useState(true);
const [connectionStatus, setConnectionStatus] = useState('online');

const [activeCall, setActiveCall] = useState(null);
const [callStatus, setCallStatus] = useState('idle'); // idle, ringing, connecting, connected, ended
const [isIncomingCall, setIsIncomingCall] = useState(false);
const [activeCaller, setActiveCaller] = useState(null);
const [isMuted, setIsMuted] = useState(false);
const [isSpeakerOn, setIsSpeakerOn] = useState(false);

  // Subscription States
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("BASIC");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);  
const [isUploading, setIsUploading] = useState(false);
const [previewFile, setPreviewFile] = useState(null); // The actual file object
const [previewUrl, setPreviewUrl] = useState(null);   // The local blob for <img> src
const [caption, setCaption] = useState("");          // The text to send with the image

  const plans = [
    {
      tier: 'BASIC',
      term: '1 Month',
      price: 15,
      frequency: '/mo',
      popular: false,
      features: ['Instant Link', 'Unlimited Chats', 'Dashboard'],
    },
    {
      tier: 'GROWTH',
      term: '6 Months',
      price: 45,
      frequency: '',
      popular: true,
      features: ['All Basic', 'Priority Routing', '24/7 Support'],
    },
    {
      tier: 'PROFESSIONAL',
      term: '1 Year',
      price: 110,
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

useEffect(() => {
  if (socket) {
    socket.on('force-logout', (data) => {
      console.warn(data.message);
      
      const savedData = localStorage.getItem('agentToken');
      let slug = "";
      
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          slug = parsed.slug || "";
        } catch (e) {
          console.error("Could not parse agent data for redirect");
        }
      }

      localStorage.removeItem('token');
      localStorage.removeItem('agentToken');
            alert(data.message);
            if (slug) {
        window.location.href = `/login/${slug}?reason=dual_login`;
      } else {
        window.location.href = '/login?reason=dual_login';
      }
    });
  }

  return () => {
    if (socket) socket.off('force-logout');
  };
}, [socket]);

useEffect(() => {
  const ringtone = ringtoneRef.current;

  if (callStatus === 'ringing' && isIncomingCall) {
    ringtone.loop = true;
    ringtone.play().catch(err => console.warn("Audio autoplay blocked by browser"));
  } else {
    ringtone.pause();
    ringtone.currentTime = 0;
  }

  return () => {
    ringtone.pause();
    ringtone.currentTime = 0;
  };
}, [callStatus, isIncomingCall]);

// --- EFFECT: Socket Listeners ---
useEffect(() => {
  if (!socket || !agentData?._id) return;
  socket.emit("join-main-room", agentData._id);

  const onIncoming = (data) => {
    // Handshake: Tell the sender we are ringing
    socket.emit("confirm-ringing", { to: data.fromId });
    
    if (callStatus === 'idle') {
      setActiveCaller(data);
      setActiveCall({ callId: data.callId }); 
      setIsIncomingCall(true);
      setCallStatus('ringing');
    }
  };
  const onUserRinging = () => {
    // WHATSAPP LOGIC: Change "Calling..." to "Ringing..."
    setCallStatus(prev => (prev === 'calling' ? 'ringing' : prev));
  };

  socket.on("incoming-call", onIncoming);
  socket.on("user-is-ringing", onUserRinging);
  socket.on("call-accepted", (signal) => {
    if (connectionRef.current && signal) connectionRef.current.signal(signal);
    setCallStatus('connected');
  });
  socket.on("call-ended", handleEndCall);

  return () => {
    socket.off("incoming-call");
    socket.off("user-is-ringing");
    socket.off("call-accepted");
    socket.off("call-ended");
  };
}, [agentData?._id, socket]);

useEffect(() => {
  const token = localStorage.getItem('agentToken');
  if (!token) return;

  const syncStatus = async () => {
    // Only poll for status if we are currently trying to reach someone
    if (callStatus === 'calling' && activeCall?.callId) {
      try {
        const res = await fetch(`/api/calls/status/${activeCall.callId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.status === 'ringing') setCallStatus('ringing');
      } catch (e) { console.warn("Status poll failed"); }
    }

    // Standard Incoming Call Check
    if (callStatus === 'idle') {
      try {
        const res = await fetch('/api/calls/check-incoming', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.hasIncomingCall) {
          setActiveCaller(data.callerData);
          setActiveCall({ callId: data.callId });
          setIsIncomingCall(true);
          setCallStatus('ringing');
        }
      } catch (e) { console.error(e); }
    }
  };

  const interval = setInterval(syncStatus, 3000);
  return () => clearInterval(interval);
}, [callStatus, activeCall?.callId]);


 useEffect(() => {
  if (messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }
}, [messages]); 

useEffect(() => {
  const ringtone = ringtoneRef.current;
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

const handleStartCall = async (targetUserId) => {
  if (!targetUserId || !agentData) return;
  const token = localStorage.getItem('agentToken');

  // PHASE 1: Initial network request
  setCallStatus('calling');
  setIsIncomingCall(false);

  try {
    const res = await fetch('/api/calls/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        receiverId: targetUserId,
        receiverModel: 'User'
      })
    });

    const dbCall = await res.json();
    if (!res.ok) throw new Error(dbCall.message);

    // Save the call ID so the polling/socket knows which call to track
    setActiveCall({ callId: dbCall.callId });

    // Emit socket to wake up the User's dashboard
    socket.emit("call-user", {
      userToCall: targetUserId,
      fromId: agentData._id,
      fromName: `${agentData.firstName} ${agentData.lastName}`,
      callId: dbCall.callId
    });

    // WebRTC Setup...
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // ... rest of your Peer logic
  } catch (err) {
    console.error("Call failed:", err);
    setCallStatus('idle');
  }
};

const handleAcceptCall = async () => {
  try {
    // 1. UI Transition to "Securing Line..."
    setCallStatus('connecting');

    // 2. Capture Agent's Audio
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    
    // Store local stream so we can toggle Mute/Speaker later
    userStreamRef.current = stream; 

    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream: stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }, // Essential for connecting over different networks
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    // 3. Signal back to the User (Handshake)
    peer.on('signal', (data) => {
      socket.emit("answer-call", { 
        to: activeCaller.fromId, 
        signal: data 
      });
    });

    // 4. Handle the incoming Voice Stream
    peer.on('stream', (remoteStream) => {
      // Create a hidden audio element
      const audio = document.createElement('audio');
      audio.id = 'remoteAudio';
      audio.srcObject = remoteStream;
            audio.muted = false; 
      
      remoteStreamRef.current = remoteStream; // Save for later reference
      
      audio.play().then(() => {
        setCallStatus('connected'); // Only set connected once audio is flowing
        startTimer(); // Trigger your 00:05 counter
      }).catch(e => console.error("Audio play blocked:", e));
    });
    peer.signal(activeCaller.signal); 
    
    connectionRef.current = peer;
    peer.on('close', () => handleEndCall());
    peer.on('error', (err) => {
      console.error("Peer Error:", err);
      handleEndCall();
    });

  } catch (err) {
    console.error("Access Denied to Microphone:", err);
    setCallStatus('idle');
    alert("Please allow microphone access to answer calls.");
  }
};

const handleEndCall = () => {
  const targetId = activeCaller?.fromId || selectedUser?._id;
  if (targetId && socket) {
    socket.emit("end-call", { to: targetId });
  }
  
  if (connectionRef.current) {
    connectionRef.current.destroy();
    connectionRef.current = null;
  }

  // Reset all states
  setCallStatus('idle');
  setIsIncomingCall(false);
  setActiveCaller(null);
  
  // Stop the ringtone if it's still playing
  if (ringtoneRef.current) {
    ringtoneRef.current.pause();
    ringtoneRef.current.currentTime = 0;
  }
};

useEffect(() => {
  if (userStreamRef.current) {
    userStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !isMuted;
    });
  }
}, [isMuted]);

useEffect(() => {
  const remoteAudio = document.getElementById('remoteAudio');
  if (remoteAudio) {
    // If "Speaker" is off, we lower volume to simulate earpiece, 
    // or keep at 1 for loud speaker.
    remoteAudio.volume = isSpeakerOn ? 1.0 : 0.3; 
  }
}, [isSpeakerOn]);

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

  // --- INITIAL FETCH & SCRIPT LOAD ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://checkout.flutterwave.com/v3.js";
    script.async = true;
    document.body.appendChild(script);

    const fetchInitialData = async () => {
      const token = localStorage.getItem('agentToken');
      if (!token) return navigate('/');

      try {
        const profileRes = await fetch('/api/agents/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!profileRes.ok) {
            const errorMsg = await profileRes.json();
            console.error("Profile Error:", errorMsg);
            return;
        }
      const profileData = await profileRes.json();
        setAgentData(profileData);
        setIsSubscribed(profileData.isSubscribed && !profileData.isExpired);
        if (profileData.plan) setSelectedPlan(profileData.plan);

        if (profileData.isSubscribed) {
          const response = await fetch('/api/agents/my-users', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const userData = await response.json();
          
          if (userData.success && Array.isArray(userData.users)) {
            setUsers(userData.users);

          setSelectedUser(prev => {
        if (!prev) return null;
      const freshUserData = userData.users.find(u => u._id === prev._id);
  
        return freshUserData ? { ...prev, ...freshUserData } : prev;
      });
            
          } else {
            setUsers([]);
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
        if (document.body.contains(script)) {
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
      const rateRes = await fetch(`/api/subscriptions/rate/${activePlan.price}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!rateRes.ok) throw new Error("Could not fetch current exchange rate");
      
      const rateData = await rateRes.json();
      const finalNairaAmount = rateData.ngn; 

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
          description: `Activation for ${activePlan.tier} Plan ($${activePlan.price})`,
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
                usdAmount: activePlan.price 
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
      alert("Failed to initialize payment. Please check your connection.");
      setPaymentProcessing(false);
    }
  };
  

const handleFileUpload = (e) => {
  const file = e.target.files[0];
  // Using selectedUser to match your dashboard's state
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

  if (previewUrl) URL.revokeObjectURL(previewUrl);

  setPreviewFile(file);
  setPreviewUrl(URL.createObjectURL(file));
  setCaption(""); 

  if (e.target) e.target.value = null; 
};

const handleDownload = async (fileUrl, fileName) => {
  try {
    const response = await fetch(fileUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Download failed:", error);
  }
};

const handleFinalSend = async () => {
  if (!previewFile || isUploading || !selectedUser) return;

  setIsUploading(true);

  try {
    const token = localStorage.getItem('agentToken');
    const detectedType = previewFile.type.startsWith('video/') ? 'video' : 'image';

    // --- STEP 1: GET THE UPLOAD PERMISSION (PRESIGNED URL) ---
    // We send only the metadata (name, type) to avoid Vercel's size limits
    const urlResponse = await fetch('/api/messages/get-upload-url', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        fileName: previewFile.name, 
        fileType: previewFile.type 
      })
    });

    const urlData = await urlResponse.json();
    
    if (!urlData.success || !urlData.uploadUrl) {
      throw new Error(urlData.message || "Could not generate upload permission.");
    }

    const { uploadUrl, key } = urlData;

    const directUpload = await fetch(uploadUrl, {
      method: 'PUT',
      body: previewFile,
      headers: { 
        'Content-Type': previewFile.type 
      }
    });

    if (!directUpload.ok) {
      throw new Error("Failed to upload media to storage server.");
    }

    const confirmResponse = await fetch('/api/messages/confirm-upload', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({
        receiverId: selectedUser._id,
        text: caption,
        fileUrl: key, // Using the path returned from Step 1
        fileType: detectedType
      })
    });

    const finalData = await confirmResponse.json();

    if (finalData.success) {
      // Success! Update local UI
      setMessages(prev => [...prev, finalData.message]);
      setPreviewUrl(null);
      setPreviewFile(null);
      setCaption("");
    } else {
      alert(finalData.error || "Database failed to record the message.");
    }

  } catch (err) {
    console.error("Critical Upload Error:", err);
    alert(err.message || "System error during upload.");
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
    setMessages([]); 
  setSelectedUser(user);
  setLimit(30); // Always reset to 30 when switching to a new user

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
      console.error("Server returned an error while fetching messages");
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

// Add this to your Agent Dashboard
useEffect(() => {
  const heartBeat = setInterval(async () => {
    const token = localStorage.getItem('agentToken');
    await fetch('/api/agents/heartbeat', { 
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${token}` } 
    });
  }, 60000); // Every minute

  return () => clearInterval(heartBeat);
}, []);

useEffect(() => {
  // 1. Reset initial load flag whenever the user changes
  setIsInitialLoad(true);
}, [selectedUser?._id]);

useEffect(() => {
  const container = scrollRef.current;
  if (!container) return;

  requestAnimationFrame(() => {
    if (isInitialLoad) {
      container.scrollTop = container.scrollHeight;
      setIsInitialLoad(false);
    } else {
      const threshold = 150; // Increased threshold for better UX
      const isNearBottom = 
        container.scrollHeight - container.scrollTop <= container.clientHeight + threshold;

      if (isNearBottom) {
        container.scrollTo({ 
          top: container.scrollHeight, 
          behavior: 'smooth' 
        });
      }
    }
  });
}, [messages, isInitialLoad]); // Added isInitialLoad to deps

// --- REAL-TIME UPDATES (POLLING) ---
useEffect(() => {
  if (!isSubscribed) return;

  const refreshData = async () => {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

    try {
      // 1. Update the User List (Sidebar) to see new messages/online status
      const userRes = await fetch('/api/agents/my-users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const userData = await userRes.json();
      if (userData.success && Array.isArray(userData.users)) {
        setUsers(userData.users);
      }

      // 2. If a chat is open, update the messages (for the blue checkmarks)
      if (selectedUser) {
        const msgRes = await fetch(`/api/messages/${selectedUser._id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const msgData = await msgRes.json();
        if (msgData.success) {
          setMessages(msgData.messages);
        }
      }
    } catch (err) {
      console.error("Polling refresh error:", err);
    }
  };

  const interval = setInterval(refreshData, 5000); // Refresh every 5 seconds
  return () => clearInterval(interval);
}, [selectedUser, isSubscribed]);

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
  // 1. Request Permission for Popups on Load
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  if (!isSubscribed || !selectedUser?._id) return;

  const refreshMessages = async () => {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

    try {
      const response = await fetch(`/api/messages/${selectedUser._id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.success && Array.isArray(data.messages)) {
        const incomingMessages = data.messages;
        const lastMessage = incomingMessages[incomingMessages.length - 1];

        // NEW LOGIC: Only alert if it's a NEW unread message from a User
        if (
          lastMessage && 
          lastMessage.senderModel === 'User' && 
          lastMessage.status !== 'seen' &&
          lastMessage._id !== lastNotifiedId.current
        ) {
          // Update ref immediately to kill the loop
          lastNotifiedId.current = lastMessage._id;

          // A. Play Sound
          notificationSound.currentTime = 0;
          notificationSound.play().catch(e => console.log("Audio blocked by mobile browser"));

          // B. Browser Notification
          if (Notification.permission === "granted") {
            const popup = new Notification(`New Message: ${selectedUser.firstName}`, {
              body: lastMessage.text || "Sent a file",
              icon: selectedUser.photoUrl || '/favicon.ico',
              tag: 'zing-msg'
            });
            popup.onclick = () => { window.focus(); popup.close(); };
          }

          // C. Background Mark-Read (Stops the server from thinking it's still new)
          fetch(`/api/messages/mark-read/${selectedUser._id}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` }
          }).catch(err => console.error("Auto-mark read failed:", err));
        }
        
        setMessages(incomingMessages);
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  };

  const pollInterval = setInterval(refreshMessages, 5000);
  return () => clearInterval(pollInterval);
}, [selectedUser?._id, isSubscribed]);

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
    <div className="h-screen flex items-center justify-center bg-[#f0f2f5] text-[10px] font-bold uppercase tracking-widest text-gray-400">
      Initializing Secure Portal...
    </div>
  );

  return (
    <div className="h-screen w-screen bg-[#f0f2f5] flex overflow-hidden font-sans antialiased text-slate-900 relative">

      {/* --- 1. ADD CONNECTION STATUS BAR HERE --- */}
{(connectionStatus === 'offline' || connectionStatus === 'connecting') && (
  <div className={`fixed top-0 left-0 w-full z-[50000] py-1.5 flex items-center justify-center gap-3 animate-in slide-in-from-top duration-300 ${
    connectionStatus === 'offline' ? 'bg-[#ea0038]' : 'bg-[#ffb300]'
  }`}>
    <div className="flex items-center gap-2 text-white">
      {connectionStatus === 'offline' ? (
        <span className="text-[10px] font-black uppercase tracking-widest">Not Connected</span>
      ) : (
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest">Connecting to Secure Node...</span>
        </div>
      )}
    </div>
  </div>
)}
      
    {showSuccessOverlay && (
      <div className="fixed inset-0 z-[20000] bg-blue-600 flex flex-col items-center justify-center text-white p-6">
        <div className="bg-white/10 p-6 rounded-full mb-6">
           <BsCheckCircleFill size={60} className="text-white animate-bounce" />
        </div>
        <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-2 text-center">
          Activation Successful!
        </h1>
        <p className="text-sm md:text-lg font-medium opacity-90 text-center max-w-xs mb-8">
          Your <strong>{selectedPlan}</strong> plan ($ {plans.find(p => p.tier === selectedPlan)?.price}) has been activated. Your users can now connect to your secure node.
        </p>
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-white text-blue-600 font-black py-4 rounded-xl shadow-xl active:scale-95 uppercase tracking-widest text-[11px]"
          >
            Return to Dashboard
          </button>
          <p className="text-[10px] uppercase font-bold tracking-[0.2em] opacity-60">
            Redirecting in 4 seconds...
          </p>
        </div>
      </div>
    )}

      {!isSubscribed && !showSuccessOverlay && (
        <div className="absolute inset-0 z-[10000] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in fade-in zoom-in duration-300 max-h-[90vh] md:max-h-none overflow-y-auto">
            <div className="bg-blue-600 p-6 md:p-10 text-white md:w-1/3 flex flex-col justify-between border-b md:border-b-0 md:border-r border-blue-500">
              <div>
                <BsShieldLockFill size={32} className="mb-4 opacity-90" />
                <h2 className="text-xl md:text-3xl font-black uppercase tracking-tighter leading-none mb-3">Account Inactive</h2>
                <p className="text-blue-100 text-[11px] md:text-sm leading-relaxed opacity-90">
                  Access to your dashboard, leads, and encrypted messaging requires an active subscription.
                </p>
              </div>
              <div className="mt-8 pt-8 border-t border-blue-500/50 hidden md:block">
                <p className="text-[10px] uppercase font-bold tracking-widest opacity-60 mb-1">Current Selection</p>
                <p className="text-3xl font-black">{selectedPlan}</p>
              </div>
            </div>

            <div className="p-6 md:p-12 md:w-2/3 bg-gray-50 flex flex-col">
              <h3 className="text-sm md:text-xl font-bold text-gray-800 mb-6">Choose Your Access Tier</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {plans.map((plan) => (
                  <div 
                    key={plan.tier}
                    onClick={() => setSelectedPlan(plan.tier)}
                    className={`cursor-pointer p-4 rounded-2xl border-2 transition-all duration-300 relative flex flex-col justify-between ${
                      selectedPlan === plan.tier 
                        ? 'border-blue-600 bg-white shadow-xl scale-[1.03] z-10' 
                        : 'border-gray-200 bg-white hover:border-blue-300 opacity-80'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[9px] font-black uppercase tracking-widest ${selectedPlan === plan.tier ? 'text-blue-600' : 'text-gray-400'}`}>
                          {plan.tier}
                        </span>
                        {selectedPlan === plan.tier && <BsCheckCircleFill className="text-blue-600" size={16} />}
                      </div>
                      <div className="text-xl md:text-2xl font-black text-gray-900 leading-none">
                        ${plan.price}
                        <span className="text-[10px] font-normal text-gray-400 ml-1">{plan.frequency}</span>
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase mt-1 tracking-tight">{plan.term}</p>
                    </div>
                    {plan.popular && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">
                        Best Value
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-white p-5 md:p-8 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                <div className="flex items-center gap-3 mb-4 text-gray-800">
                  <BsCreditCard2BackFill size={18} className="text-blue-600" />
                  <span className="text-xs md:text-sm font-bold uppercase tracking-wide">Summary & Checkout</span>
                </div>
                <p className="text-[11px] md:text-sm text-gray-500 mb-6 leading-relaxed">
                  Activating <strong>{selectedPlan}</strong> access for <strong>${plans.find(p => p.tier === selectedPlan)?.price}</strong>. 
                </p>
                <button 
                  disabled={paymentProcessing}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-4 rounded-xl transition-all shadow-lg active:scale-[0.97] uppercase tracking-widest text-[11px]"
                  onClick={handlePayment}
                >
                  {paymentProcessing ? "Processing..." : `Activate ${selectedPlan} Access`}
                </button>
                <p className="text-[9px] text-center text-gray-400 mt-4 uppercase tracking-tighter font-medium italic">
                  Instant Activation • 256-bit SSL Encryption
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-[30%] lg:min-w-[350px] bg-white border-r border-gray-300 flex-col z-[100]`}>
        <header className="h-[50px] md:h-[60px] bg-[#f0f2f5] px-3 flex justify-between items-center border-b border-gray-200 shrink-0">
          <button onClick={() => navigate('/agent/profile')} className="h-10 w-10 rounded-full hover:bg-gray-200 flex items-center justify-center">
            <BsPersonCircle size={32} className="text-gray-400" />
          </button>
          <BsThreeDotsVertical className="cursor-pointer text-gray-500" size={18} />
        </header>

        <div className="p-2 bg-white">
          <div className="bg-[#f0f2f5] flex items-center px-3 py-1.5 rounded-lg">
            <BsSearch className="text-gray-500 mr-3" size={12} />
            <input placeholder="Search" className="bg-transparent text-xs w-full outline-none" />
          </div>
        </div>

        {/* User list in sidebar */}
{/* User list in sidebar */}
<div className="flex-1 overflow-y-auto">
  {users.length > 0 ? users.map((user) => (
    <div 
      key={user._id}
      onClick={() => handleSelectUser(user)}
      className={`flex items-center px-4 py-3 cursor-pointer hover:bg-[#f5f6f6] border-b border-gray-50 transition-colors ${
        selectedUser?._id === user._id ? 'bg-[#ebebeb]' : ''
      }`}
    >
      <div className="relative shrink-0">
        <div className="w-11 h-11 rounded-full overflow-hidden border border-gray-200 bg-white flex items-center justify-center">
      <img 
  src={user.photoUrl} 
  alt={`${user.firstName} ${user.lastName}`} 
  className="w-full h-full object-cover"
  crossOrigin="anonymous" 
  referrerPolicy="no-referrer-when-downgrade"
  loading="lazy" 
  decoding="async" 
  onError={(e) => {
    console.warn(`S3 Load failed for ${user.email}, switching to fallback.`);
    e.target.onerror = null; // Prevents infinite loops
    // Cleanly encoded name for the fallback API
    const fallbackName = encodeURIComponent(`${user.firstName} ${user.lastName}`);
    e.target.src = `https://ui-avatars.com/api/?name=${fallbackName}&background=random&color=fff`;
  }} 
/>
        </div>
        
        {/* Status indicator */}
        <div className={`absolute -bottom-0.5 -right-0.5 border-2 border-white w-4 h-4 rounded-full flex items-center justify-center ${user.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}>
          {user.isVerified && <BsCheckAll className="text-white" size={12} />}
        </div>
      </div>

      <div className="ml-3 flex-1 overflow-hidden">
        <div className="flex flex-col justify-center">
          <h3 className="text-[13px] font-bold text-gray-800 truncate leading-tight">
            {user.firstName ? `${user.firstName} ${user.lastName}` : 'Unknown User'}
          </h3>
          {/* Email displays below name */}
          <p className="text-[11px] font-medium text-gray-500 lowercase truncate leading-tight mb-0.5">
            {user.email}
          </p>
        </div>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter truncate">
          {user.city}, {user.state} • <span className={user.status === 'online' ? 'text-green-600' : 'text-gray-400'}>
            {user.status === 'online' ? 'Online' : 'Offline'}
          </span>
        </p>
      </div>
    </div>
  )) : (
    <p className="text-center text-gray-500 py-10">No users connected.</p>
  )}
</div>
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-red-100 text-red-500 rounded-xl hover:bg-red-50 hover:text-red-600 transition-all duration-200 group shadow-sm active:scale-95"
          >
            <div className="bg-red-50 group-hover:bg-red-100 p-2 rounded-lg transition-colors">
              <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </div>
            <span className="text-[11px] font-black uppercase tracking-widest">Disconnect Session</span>
          </button>
        </div>
      </aside>

    <main className={`${!showSidebar ? 'flex' : 'hidden'} lg:flex flex-1 flex-col bg-[#efeae2] relative overflow-hidden`}>
  {selectedUser ? (
    <>
      <header className="h-[55px] md:h-[65px] bg-[#f0f2f5] px-3 flex justify-between items-center z-10 border-l border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowSidebar(true)} className="lg:hidden p-2 text-gray-600 hover:bg-gray-200 rounded-full transition-colors">
            <BsChevronLeft size={18} />
          </button>
          
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden border border-gray-200 bg-white bg-gray-200 shrink-0 shadow-sm">
          <img 
  src={selectedUser.photoUrl} 
  alt="Profile" 
  className="w-full h-full object-cover" 
  crossOrigin="anonymous" 
  referrerPolicy="no-referrer-when-downgrade"
  loading="lazy"      // Only loads when it's about to enter the screen
  decoding="async"    // Prevents the image decoding from blocking the UI thread
  // ---------------------------
  onError={(e) => {
    e.target.onerror = null; 
    const name = encodeURIComponent(`${selectedUser.firstName} ${selectedUser.lastName}`);
    e.target.src = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff`;
  }}
/>
          </div>

          <div className="overflow-hidden flex flex-col justify-center">
            <h2 className="text-sm font-bold text-gray-800 truncate max-w-[140px] md:max-w-none leading-tight">
              {selectedUser.firstName ? `${selectedUser.firstName} ${selectedUser.lastName}` : 'Unknown User'}
            </h2>
            <p className="text-[11px] font-medium text-gray-500 lowercase truncate leading-tight">
              {selectedUser.email}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${selectedUser.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
              <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">
                {selectedUser.city ? `${selectedUser.city}, ${selectedUser.state}` : 'Verified Node'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 md:gap-6 text-gray-500 mr-2">
          <button 
            onClick={() => {
              setIsIncomingCall(false); 
              setCallStatus('ringing'); 
              handleStartCall(selectedUser._id); 
            }}
            className="hover:text-green-600 transition-colors active:scale-90 p-2" 
            title="Voice Call"
          >
            <BsTelephoneFill size={18} />
          </button>
          <div className="h-6 w-[1px] bg-gray-300 mx-1 hidden md:block"></div>
          <BsThreeDotsVertical className="cursor-pointer hover:text-blue-600 transition-colors" size={18} />
        </div>
      </header>

     <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:px-20 space-y-2 z-10 flex flex-col bg-[#e5ddd5]">
  {messages.length >= limit && (
    <div className="flex justify-center py-6">
      <button onClick={() => setLimit(prev => prev + 30)} className="text-[10px] font-black uppercase tracking-[0.2em] bg-white border border-gray-200 text-gray-400 px-6 py-2.5 rounded-full hover:bg-gray-50 hover:text-blue-600 transition-all shadow-sm active:scale-95">
        ↑ Load Older Messages
      </button>
    </div>
  )}

       {messages.map((m) => {
    const isMe = m.senderModel === 'Agent';
    // Use a robust key to prevent React errors during optimistic updates
    const msgKey = m._id || m.id || `temp-${m.createdAt}-${Math.random()}`;

    return (
      <div 
        key={msgKey} 
        className={`max-w-[85%] md:max-w-[65%] px-3 py-1.5 rounded-lg shadow-sm relative animate-in fade-in slide-in-from-bottom-1 flex flex-col ${
          isMe ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
        } mb-1`}
      >
        {/* Media Handling */}
        {(m.fileType === 'image' || m.fileType === 'video') && (
          <div className="relative mb-1.5 mt-0.5 group">
            {m.fileType === 'image' ? (
              <>
                <img src={m.fileUrl} alt="attachment" onClick={() => setFullscreenImage(m.fileUrl)} className="rounded-lg bg-gray-100 object-cover w-full max-w-[280px] max-h-[320px] md:max-w-[400px] md:max-h-[500px] cursor-pointer transition-opacity hover:opacity-95" />
                <button onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'image'); }} className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"><BsDownload size={14} /></button>
              </>
            ) : (
              <div className="relative">
                <video className="rounded-lg w-full max-w-[280px] md:max-w-[400px] max-h-[500px] bg-black shadow-inner cursor-pointer" onClick={() => setFullscreenVideo(m.fileUrl)}><source src={m.fileUrl} type="video/mp4" /></video>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="bg-black/40 p-3 rounded-full text-white backdrop-blur-sm"><BsPlayFill size={30} /></div></div>
                <button onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'video'); }} className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-20"><BsDownload size={14} /></button>
              </div>
            )}
          </div>
        )}

        {/* Text Content */}
        {m.text && (
          <p className={`text-[13px] md:text-[15px] text-[#303030] leading-relaxed break-words ${m.fileType ? 'px-1 pb-1 pt-1' : 'pr-8'}`}>
            {m.text}
          </p>
        )}

        {/* Time / Status Bar - REPLACED OLD STATUS ICON LOGIC */}
        <div className="flex items-center justify-end gap-1 mt-1 border-t border-black/5 pt-0.5 min-w-[65px]">
          <span className="text-[9px] text-gray-400 font-bold uppercase">
            {new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>

          {isMe && (
            <div className="flex items-center ml-1">
              {/* 1. SENDING: Dynamic Spinner */}
              {m.status === 'sending' && (
                <div className="w-2.5 h-2.5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              )}

              {/* 2. FAILED: Retry Button */}
              {m.status === 'failed' && (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleResend(m); }}
                  className="flex items-center bg-red-500 text-white px-1.5 py-0.5 rounded shadow-sm hover:bg-red-600 active:scale-95 transition-all"
                >
                  <span className="text-[8px] font-black mr-1 uppercase">Retry</span>
                  <BsPlusLg className="rotate-45" size={10} />
                </button>
              )}

              {/* 3. SUCCESS: WhatsApp Style Ticks */}
              {(!m.status || m.status === 'sent' || m.status === 'seen') && (
                <div className="flex items-center">
                  {m.status === 'seen' ? (
                    <BsCheckAll className="text-blue-500" size={16} />
                  ) : (
                    <BsCheckAll className="text-gray-400" size={16} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  })}
  {/* IMPORTANT: Ensure this scroll anchor exists for smooth scrolling */}
  <div className="h-10 shrink-0 w-full clear-both" />
  <div ref={messagesEndRef} />
</div>

      <footer className="min-h-[60px] bg-[#f0f2f5] px-2 md:px-4 py-2 flex items-center gap-2 z-10 border-t border-gray-200">
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,video/*" className="hidden" />
        <input type="file" ref={cameraInputRef} onChange={handleFileUpload} accept="image/*,video/*" capture="environment" className="hidden" />
        <div className="flex items-center gap-1 md:gap-3 text-gray-500">
          <button type="button" onClick={() => fileInputRef.current.click()} disabled={isUploading} className="p-2 hover:bg-gray-200 rounded-full transition-all active:scale-90"><svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" height="20" width="20"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg></button>
          <button type="button" onClick={() => cameraInputRef.current.click()} disabled={isUploading} className="p-2 hover:bg-gray-200 rounded-full transition-all active:scale-90"><svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="20" width="20"><path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 7.07 3h1.858a1 1 0 0 1 .707.293l.83.828a3 3 0 0 0 2.12.879H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/><path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/></svg></button>
        </div>
        <form onSubmit={handleSendMessage} className="flex-1 flex items-center gap-2">
          <input disabled={isUploading} value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder={isUploading ? "Uploading..." : "Type a message"} className="flex-1 bg-white px-4 py-2.5 rounded-full text-sm outline-none border border-gray-200 focus:border-blue-300 transition-all" />
          <button type="submit" disabled={isUploading || !newMessage.trim()} className={`p-3 rounded-full transition-all active:scale-90 shadow-md ${newMessage.trim() && !isUploading ? 'bg-blue-600 text-white' : 'bg-gray-400 text-white'}`}><svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="18" width="18"><path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576 6.636 10.07Zm6.787-8.201L1.591 6.602l4.339 2.76 7.494-7.493Z"/></svg></button>
        </form>
      </footer>
    </>
  ) : (
    <div className="flex-1 flex flex-col items-center justify-center text-center opacity-30">
      <BsShieldLockFill size={40} className="mb-4" />
      <h1 className="text-2xl font-black uppercase tracking-widest text-blue-950">ZingConnect</h1>
      <p className="text-[10px] font-bold uppercase tracking-widest">Secure Terminal</p>
    </div>
  )}

{/* --- IN-CHAT CALL STATUS BAR --- */}
{callStatus !== 'idle' && (
  <div className={`h-12 flex items-center justify-between px-6 z-20 transition-all duration-300 ${
    callStatus === 'connected' ? 'bg-[#06d755] text-white' : 'bg-blue-600 text-white'
  }`}>
    <div className="flex items-center gap-3">
      <div className="flex gap-1">
        <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:-0.3s]"></span>
        <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:-0.15s]"></span>
        <span className="w-1 h-1 bg-white rounded-full animate-bounce"></span>
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest">
        {callStatus === 'connected' ? 'Call in Progress' : 'Attempting Secure Link...'}
      </span>
    </div>
    <div className="flex items-center gap-4">
       <span className="text-xs font-mono opacity-80">00:05</span>
       <button onClick={() => setFullscreenCall(true)} className="text-[9px] font-black border border-white/30 px-2 py-1 rounded hover:bg-white/10 uppercase">
         Expand
       </button>
    </div>
  </div>
)}

  {/* --- ACTIVE CALL OVERLAY --- */}
  {callStatus !== 'idle' && (
    <div className="fixed inset-0 z-[40000] bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
      <div className="flex flex-col items-center space-y-10">
        
        {/* 1. CALLER AVATAR */}
        <div className="w-40 h-40 rounded-full border-4 border-blue-500/20 p-1 relative">
          <img 
            src={isIncomingCall ? activeCaller?.photoUrl : selectedUser?.photoUrl || "/default-avatar.png"} 
            className="w-full h-full rounded-full object-cover shadow-2xl" 
            alt="Caller"
            onError={(e) => {
              e.target.src = `https://ui-avatars.com/api/?name=${isIncomingCall ? activeCaller?.fromName : selectedUser?.firstName}&background=0D1117&color=fff`;
            }}
          />
          <div className="absolute inset-0 w-full h-full bg-blue-500 rounded-full animate-ping opacity-10"></div>
        </div>

        {/* 2. TEXT & STATUS */}
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tighter text-white">
            {isIncomingCall 
              ? (activeCaller?.fromName || "Incoming Call...") 
              : (selectedUser ? `${selectedUser.firstName} ${selectedUser.lastName}` : "Secure Line")}
          </h2>

          <div className="flex flex-col items-center gap-3 mt-4">
           <div className="flex items-center gap-2">
  <span className={`w-2 h-2 rounded-full transition-all duration-500 ${
    callStatus === 'connected' 
      ? 'bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]' 
      : callStatus === 'connecting'
        ? 'bg-yellow-400 animate-spin shadow-[0_0_8px_#fbbf24]' // Spinning during handshake
      : callStatus === 'ringing'
        ? 'bg-blue-400 animate-ping shadow-[0_0_8px_#60a5fa]'   // Pinging when user's phone is active
      : callStatus === 'calling'
        ? 'bg-slate-400 animate-pulse'                         // Soft pulse while searching network
        : 'bg-slate-500'
  }`}></span>

  <p className="text-blue-400 font-black uppercase tracking-[0.4em] text-[10px] italic">
    {/* Phase 1: Agent has clicked call, waiting for backend/network response */}
    {callStatus === 'calling' && "Calling..."}

    {/* Phase 2: User's device has acknowledged the call (Handshake complete) */}
    {callStatus === 'ringing' && "Ringing..."}
    
    {/* Phase 3: User clicked 'Answer', WebRTC is negotiating the stream */}
    {callStatus === 'connecting' && "Securing Line..."}
    
    {/* Phase 4: Active voice conversation */}
    {callStatus === 'connected' && "Line Encrypted"}
  </p>
</div>
            {callStatus === 'connected' && <span className="text-white/40 font-mono text-xs tracking-widest">00:05</span>}
          </div>
        </div>

        {/* 3. DYNAMIC CONTROLS (INCOMING VS ACTIVE) */}
        <div className="flex items-center justify-center gap-10 mt-16">
          {isIncomingCall && callStatus === 'ringing' ? (
            <>
              {/* Decline */}
              <div className="flex flex-col items-center gap-2">
                <button onClick={handleEndCall} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-2xl shadow-red-500/40 active:scale-95">
                  <div className="rotate-[135deg]"><BsTelephoneFill size={32} color="white" /></div>
                </button>
              <span className="text-[9px] font-bold uppercase text-red-500/60 tracking-widest">
  {callStatus === 'connected' ? 'End Call' : 'Cancel'}
</span>
              </div>
              {/* Accept */}
              <div className="flex flex-col items-center gap-2">
                <button onClick={handleAcceptCall} className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center hover:bg-green-600 transition-all shadow-2xl shadow-green-500/40 animate-bounce active:scale-95">
                  <BsTelephoneFill size={32} color="white" />
                </button>
                <span className="text-[9px] font-bold uppercase text-green-500/60 tracking-widest">Accept</span>
              </div>
            </>
          ) : (
            <>
              {/* Speaker */}
              <div className="flex flex-col items-center gap-2">
                <button onClick={() => setIsSpeakerOn(!isSpeakerOn)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isSpeakerOn ? 'bg-white text-slate-900 shadow-lg shadow-white/20' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="20" width="20"><path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/><path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/><path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/></svg>
                </button>
                <span className="text-[9px] font-bold uppercase text-white/40 tracking-widest">Speaker</span>
              </div>
              {/* End Call */}
              <div className="flex flex-col items-center gap-2">
                <button onClick={handleEndCall} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-2xl shadow-red-500/40 active:scale-95">
                  <div className="rotate-[135deg]"><BsTelephoneFill size={32} color="white" /></div>
                </button>
                <span className="text-[9px] font-bold uppercase text-red-500/60 tracking-widest">{callStatus === 'connected' ? 'End Call' : 'Cancel'}</span>
              </div>
              {/* Mute */}
              <div className="flex flex-col items-center gap-2">
                <button onClick={() => setIsMuted(!isMuted)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-red-500 shadow-lg shadow-red-500/20' : 'bg-white/10 text-white hover:bg-white/20'}`}>
                  <BsMicMuteFill size={20} color="white" className={isMuted ? "opacity-100" : "opacity-50"} />
                </button>
                <span className="text-[9px] font-bold uppercase text-white/40 tracking-widest">{isMuted ? 'Muted' : 'Mute'}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )}
</main>
      {/* --- FULLSCREEN IMAGE OVERLAY --- */}
{fullscreenImage && (
  <div 
    className="fixed inset-0 z-[30000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-300"
    onClick={() => setFullscreenImage(null)} // Click outside to close
  >
    {/* Header with Controls */}
    <div className="absolute top-0 w-full p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-10">
       <button 
         className="text-white hover:text-gray-300 transition-colors"
         onClick={() => setFullscreenImage(null)} // Explicit close button
       >
         <BsChevronLeft size={28} />
       </button>

       {/* NEW DOWNLOAD BUTTON FOR IMAGES */}
       <button 
         onClick={(e) => { 
           e.stopPropagation(); // Prevents the overlay from closing
           handleDownload(fullscreenImage, 'image'); 
         }}
         className="bg-white text-black px-4 py-2 rounded-lg flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all"
         title="Save Image to Device"
       >
         <BsDownload size={16} /> Save Image
       </button>
       
       <span className="text-white text-[10px] font-black uppercase tracking-widest italic opacity-60 hidden md:block">
         Encrypted View
       </span>
    </div>

    <img 
      src={fullscreenImage} 
      className="max-w-[95%] max-h-[85%] object-contain shadow-2xl cursor-default" 
      alt="Full view" 
      onClick={(e) => e.stopPropagation()} // Prevents closing when clicking the image itself
    />
  </div>
)}

{/* --- FULLSCREEN VIDEO OVERLAY --- */}
{fullscreenVideo && (
  <div className="fixed inset-0 z-[40000] bg-black flex flex-col items-center justify-center animate-in fade-in duration-300">
    {/* Header with Controls */}
    <div className="absolute top-0 w-full p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent">
       <button onClick={() => setFullscreenVideo(null)} className="text-white hover:text-gray-300">
         <BsChevronLeft size={28} />
       </button>
       
       <button 
         onClick={() => handleDownload(fullscreenVideo, 'video')}
         className="bg-white text-black px-4 py-2 rounded-lg flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shadow-xl active:scale-95"
       >
         <BsDownload size={16} /> Save Video
       </button>
    </div>

    <video 
      src={fullscreenVideo} 
      controls 
      autoPlay 
      className="max-w-full max-h-[90vh] shadow-2xl" 
    />
  </div>
)}

{callStatus !== 'idle' && (
  <div className="fixed inset-0 z-[2000] bg-slate-900 flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
    <div className="flex flex-col items-center space-y-6">
      {/* User/Agent Avatar */}
     <div className="w-32 h-32 rounded-full border-4 border-blue-500/30 p-1 relative">
    <img 
      src={isIncomingCall ? activeCaller?.photoUrl : selectedUser?.photoUrl || "/default-avatar.png"} 
      className="w-full h-full rounded-full object-cover shadow-2xl" 
      alt="Caller"
      onError={(e) => {
        e.target.src = `https://ui-avatars.com/api/?name=${isIncomingCall ? activeCaller?.fromName : selectedUser?.firstName}&background=random&color=fff`;
      }}
    />
    {callStatus === 'ringing' && (
      <div className="absolute inset-0 w-full h-full bg-blue-500 rounded-full animate-ping opacity-20"></div>
    )}
  </div>
      
      <div className="text-center">
        <h2 className="text-2xl font-bold">{agentData?.firstName} {agentData?.lastName}</h2>
        <p className="text-blue-400 font-black uppercase tracking-[0.2em] text-xs mt-2 animate-pulse">
          {callStatus === 'ringing' && "Ringing..."}
          {callStatus === 'connecting' && "Securing Line..."}
          {callStatus === 'connected' && "00:05"} {/* Add timer logic here */}
        </p>
      </div>

      {/* Call Controls */}
      <div className="flex gap-10 mt-12">
        <button 
          onClick={handleEndCall}
          className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-xl shadow-red-500/20"
        >
          <BsTelephoneXFill size={24} />
        </button>
        
        {callStatus === 'connected' && (
          <button className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-all">
            <BsMicMuteFill size={24} />
          </button>
        )}
      </div>{/* Call Controls */}
<div className="flex items-center gap-8 mt-12">
  {/* LOUD SPEAKER BUTTON */}
  <button 
    onClick={() => setIsSpeakerOn(!isSpeakerOn)}
    className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all ${isSpeakerOn ? 'bg-white text-slate-900' : 'bg-white/10 text-white hover:bg-white/20'}`}
  >
    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="20" width="20">
      <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
      <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.61 3.89l.706.706z"/>
      <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
    </svg>
    <span className="text-[8px] font-bold uppercase mt-1">Speaker</span>
  </button>

  {/* MAIN END CALL BUTTON */}
  <button 
    onClick={handleEndCall}
    className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-2xl shadow-red-500/40 active:scale-90"
  >
    <div className="rotate-[135deg]">
       <BsTelephoneFill size={32} />
    </div>
  </button>

  {/* MUTE BUTTON */}
  <button 
    onClick={() => setIsMuted(!isMuted)}
    className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all ${isMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
  >
    {isMuted ? <BsMicMuteFill size={20} /> : <BsMicMuteFill size={20} className="opacity-50" />}
    <span className="text-[8px] font-bold uppercase mt-1">{isMuted ? 'Muted' : 'Mute'}</span>
  </button>
</div>
    </div>
  </div>
)}

{/* --- INCOMING CALL CONTROLS --- */}
{isIncomingCall && callStatus === 'ringing' && (
  <div className="flex flex-col items-center gap-8 animate-in slide-in-from-bottom-10 duration-500">
    <p className="text-sm font-bold uppercase tracking-[0.3em] text-white/60">Incoming Secure Line...</p>
    
    <div className="flex gap-16">
      {/* DECLINE BUTTON */}
      <div className="flex flex-col items-center gap-3">
        <button 
          onClick={handleEndCall} // Reusing the end call logic to decline
          className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-xl shadow-red-500/20 active:scale-90"
        >
          <BsTelephoneXFill size={24} />
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Decline</span>
      </div>

      {/* ACCEPT BUTTON */}
      <div className="flex flex-col items-center gap-3">
        <button 
          onClick={handleAcceptCall}
          className="w-16 h-16 bg-green-500 text-white rounded-full flex items-center justify-center hover:bg-green-600 transition-all shadow-xl shadow-green-500/20 animate-bounce active:scale-90"
        >
          <BsTelephoneFill size={24} />
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Accept</span>
      </div>
    </div>
  </div>
)}

{/* --- OUTGOING CALL CONTROLS --- */}
{!isIncomingCall && callStatus === 'ringing' && (
  <div className="flex flex-col items-center gap-4">
    <button 
      onClick={handleEndCall}
      className="w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-all shadow-xl shadow-red-500/20 active:scale-95"
    >
      <BsTelephoneXFill size={24} />
    </button>
    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Cancel Call</p>
  </div>
)}

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