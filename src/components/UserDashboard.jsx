import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

export const UserDashboard = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // --- STATE ---
  const [agent, setAgent] = useState(null);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  
  // Media & Upload State (FIXED NAMES)
  const [previewFile, setPreviewFile] = useState(null); 
  const [previewUrl, setPreviewUrl] = useState(null); // Added this to stop the "not defined" error
  const [caption, setCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('online');

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    city: '',
    state: ''
  });
  // --- CALL STATE ---
const [callStatus, setCallStatus] = useState('idle'); // idle, ringing, connecting, connected
const [activeCall, setActiveCall] = useState(null);
const [isMuted, setIsMuted] = useState(false);
const [isSpeakerOn, setIsSpeakerOn] = useState(false);

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
  const token = localStorage.getItem('userToken');
  if (!token) return;

  const checkIncomingCalls = async () => {
    try {
      const response = await fetch('/api/calls/check-incoming', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();

      if (data.hasIncomingCall && callStatus === 'idle') {
        setActiveCall(data.callData);
        setCallStatus('ringing');
      } else if (!data.hasIncomingCall && callStatus === 'ringing') {
        // Agent hung up before we answered
        setCallStatus('idle');
        setActiveCall(null);
      }
    } catch (err) {
      console.error("Call poll error:", err);
    }
  };

  const callInterval = setInterval(checkIncomingCalls, 3000); 
  return () => clearInterval(callInterval);
}, [callStatus]);

// --- Updated Audio Logic for UserDashboard ---
useEffect(() => {
  const ring = ringtoneRef.current;
  
  if (callStatus === 'ringing') {
    ring.loop = true;
    ring.play().catch((err) => {
      console.warn("Ringtone blocked until user interaction:", err);
    });
  } else {
    ring.pause();
    ring.currentTime = 0;
  }
  return () => {
    ring.pause();
    ring.currentTime = 0;
  };
}, [callStatus]);

const handleAcceptCall = async () => {
  const token = localStorage.getItem('userToken');
  try {
    await fetch('/api/calls/accept', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    setCallStatus('connected');
  } catch (err) {
    console.error("Failed to accept call", err);
  }
};

const handleEndCall = async () => {
  const token = localStorage.getItem('userToken');
  try {
    await fetch('/api/calls/end', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    setCallStatus('idle');
    setActiveCall(null);
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
          setUser(data.user);
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

  // --- HANDLERS ---
  const handlePhotoClick = () => fileInputRef.current.click();

const handleFileChange = (e) => {
  const file = e.target.files[0];
  
  if (file) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(file);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);    
    setCaption(""); 
  }
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
    if (selectedFile) data.append('photo', selectedFile);
    data.append('firstName', formData.firstName);
    data.append('lastName', formData.lastName);
    data.append('dob', formData.dob);
    data.append('gender', formData.gender);
    data.append('city', formData.city);
    data.append('state', formData.state);

    try {
      const res = await fetch('/api/users/update-user-onboarding', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: data
      });
      if (res.ok) setShowOnboarding(false);
    } catch (err) {
      console.error("Update failed", err);
    }
  };

 const unlockAudio = () => {
  if (notificationSound.current) {
    notificationSound.current.play()
      .then(() => {
        notificationSound.current.pause();
        notificationSound.current.currentTime = 0;
        setHasInteracted(true); // <--- ADD THIS to hide the overlay
        console.log("Audio unlocked for iOS");
      })
      .catch(e => console.error("Unlock failed", e));
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

  setIsUploading(true);
  const token = localStorage.getItem('userToken'); 
  const detectedType = previewFile.type.startsWith('video/') ? 'video' : 'image';

  try {
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
      throw new Error(urlData.message || "Could not get upload permission");
    }

    const { uploadUrl, key } = urlData;

    // --- STEP 2: DIRECT UPLOAD TO STORAGE ---
    // Uploading directly to iDrive/S3 bypassing Vercel
    const uploadResult = await fetch(uploadUrl, {
      method: 'PUT',
      body: previewFile,
      headers: { 'Content-Type': previewFile.type }
    });

    if (!uploadResult.ok) throw new Error("Media storage upload failed");
    const confirmResponse = await fetch('/api/messages/confirm-upload', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({
        receiverId: agent._id,
        text: caption.trim(),
        fileUrl: key, 
        fileType: detectedType
      })
    });

    const data = await confirmResponse.json();
    
    if (data.success) {
      // 1. Add new message to the list
      setMessages(prev => [...prev, data.message]);
      
      // 2. IMPORTANT: Clean up memory and UI
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setPreviewFile(null);
      setCaption("");
    } else {
      alert(data.error || "Upload failed");
    }
  } catch (err) {
    console.error("Critical Upload Error:", err);
    alert(err.message || "System error during upload. Please check your connection.");
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

// --- ADD THIS TO YOUR CALL HANDLERS ---
const handleStartCall = async () => {
  if (!agent?._id) return;
  const token = localStorage.getItem('userToken');

  try {
    const res = await fetch('/api/calls/start', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ 
        receiverId: agent._id,
        receiverModel: 'Agent' // Crucial so the server knows who is being called
      })
    });

    const data = await res.json();
    if (data.success) {
      setCallStatus('ringing'); // Move to ringing state (Outgoing)
      setActiveCall({ callId: data.callId });
    }
  } catch (err) {
    console.error("Failed to initiate call:", err);
    alert("Encryption line busy. Please try again.");
  }
};

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !agent?._id) return;
    
    const textToSend = newMessage;
    setNewMessage(''); 

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
          fileType: 'text'
        })
      });

      const data = await response.json();
      if (data.success) {
        setMessages(prev => [...prev, data.message]);
      }
    } catch (err) {
      console.error("Message failed to send:", err);
    }
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
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                <div onClick={handlePhotoClick} className="w-16 h-16 md:w-20 md:h-20 bg-gray-100 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 relative cursor-pointer hover:border-blue-400 transition-colors overflow-hidden">
                   {previewUrl ? <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" /> : <BsCameraFill size={20} />}
                   {!previewUrl && <span className="absolute -bottom-1 bg-blue-600 text-white text-[8px] px-2 py-0.5 rounded-full font-bold uppercase">Add Photo</span>}
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
                {agent ? `${agent.firstName} ${agent.lastName}` : 'Verified Agent'}
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
{messages.map((m) => (
  <div 
    key={m._id || m.id} 
    className={`max-w-[85%] md:max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm relative z-10 animate-in fade-in slide-in-from-bottom-2 ${
      m.senderModel === 'User' ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
    }`}
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
              className="rounded-lg bg-gray-100 object-cover w-full max-w-[260px] max-h-[300px] md:max-w-[380px] md:max-h-[450px] cursor-pointer transition-opacity hover:opacity-95" 
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = 'https://via.placeholder.com/150?text=Image+Unavailable';
              }}
            />
            {/* Quick Download Overlay for User Dashboard */}
            <button 
              onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'image'); }}
              className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
              title="Download Image"
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

            {/* Play Indicator Overlay */}
            <div 
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              onClick={() => setFullscreenVideo(m.fileUrl)}
            >
              <div className="bg-black/40 p-3 rounded-full text-white backdrop-blur-sm">
                <BsPlayFill size={30} />
              </div>
            </div>

            {/* Quick Download Overlay for Video */}
            <button 
              onClick={(e) => { e.stopPropagation(); handleDownload(m.fileUrl, 'video'); }}
              className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-20"
              title="Download Video"
            >
              <BsDownload size={14} />
            </button>
          </div>
        )}
      </div>
    )}

    {/* Text Content (Caption) */}
    {m.text && (
      <p className={`text-[12px] md:text-[14px] leading-relaxed pr-10 break-words ${m.fileType === 'image' || m.fileType === 'video' ? 'mt-1 mb-1' : ''}`}>
        {m.text}
      </p>
    )}

    {/* Time / Status Bar */}
    <div className="flex items-center justify-end gap-1 mt-1 border-t border-black/5 pt-0.5">
      <span className="text-[9px] text-gray-400 font-bold uppercase">
        {new Date(m.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
      {/* Note: Users usually don't see status ticks in this specific app logic, 
          but you can add them here if your backend tracks User-sent message status */}
    </div>
  </div>
))}


  {/* 4. THE FIX: Scroll Anchor */}
  {/* This empty div is what the useRef targets to keep the chat scrolled down */}
  <div ref={messagesEndRef} className="h-4 shrink-0" />
</main>
{/* --- UPDATED WHATSAPP PREVIEW FOR USER DASHBOARD --- */}
{previewUrl && (
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

<footer className="shrink-0 min-h-[65px] md:min-h-[75px] bg-[#f0f2f5] px-2 md:px-6 py-3 flex items-center gap-2 md:gap-3 z-20 border-t border-gray-200 pb-safe">
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
      onClick={() => fileInputRef.current.click()} 
      disabled={isUploading}
      className="p-2 hover:bg-black/5 rounded-full transition-colors"
    >
      <BsPaperclip size={22} />
    </button>

    {/* Camera Button */}
    <button 
      onClick={() => cameraInputRef.current.click()} 
      disabled={isUploading}
      className="p-2 hover:bg-black/5 rounded-full transition-colors"
    >
      <BsCameraFill size={22} />
    </button>
  </div>
  
  <form onSubmit={handleSendMessage} className="flex-1 flex items-center gap-2">
    <input 
      value={newMessage} 
      onChange={(e) => setNewMessage(e.target.value)} 
      disabled={isUploading}
      placeholder={isUploading ? "Uploading file..." : "Type your secure message"} 
      className="w-full bg-white px-4 py-2.5 md:py-3 rounded-full text-[14px] outline-none shadow-sm border border-gray-100 focus:ring-1 ring-blue-500/20" 
    />
    
    {/* Voice/Send Toggle */}
    {newMessage.trim() ? (
      <button 
        type="submit" 
        className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg active:scale-95 transition-transform"
      >
        <BsSendFill size={16} className="ml-0.5" />
      </button>
    ) : (
      <button 
        type="button"
        className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white text-gray-500 border border-gray-100 flex items-center justify-center hover:text-blue-600"
      >
        <BsMicFill size={20} />
      </button>
    )}
  </form>
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
{/* --- CALL OVERLAY --- */}
{callStatus !== 'idle' && (
  <div className="fixed inset-0 z-[50000] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center text-white">
    <div className="flex flex-col items-center space-y-8 animate-in zoom-in duration-300">
      
      {/* Avatar with Pulsing Effect */}
      <div className="relative">
        <div className="w-32 h-32 rounded-full border-4 border-blue-500/30 p-1">
          <img 
            src={agent?.photoUrl || "/default-agent.png"} 
            className="w-full h-full rounded-full object-cover"
            alt="Agent"
          />
        </div>
        {callStatus === 'ringing' && (
          <div className="absolute -inset-4 border-2 border-blue-500/20 rounded-full animate-ping"></div>
        )}
      </div>

      <div className="text-center">
        <h2 className="text-2xl font-bold">{agent?.firstName} {agent?.lastName}</h2>
        <p className="text-blue-400 font-black uppercase tracking-widest text-[10px] mt-2 italic">
          {/* DYNAMIC STATUS TEXT */}
          {callStatus === 'ringing' && (
            activeCall?.callerData ? "Incoming Secure Call..." : "Requesting Secure Line..."
          )}
          {callStatus === 'connected' && "Line Encrypted"}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-10 mt-10">
        {callStatus === 'ringing' ? (
          <>
            {/* If there is callerData, show Accept/Decline. If not, only show End (Cancel). */}
            {activeCall?.callerData ? (
              <>
                <button onClick={handleEndCall} className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center hover:scale-110 transition-transform">
                  <BsTelephoneFill className="rotate-[135deg]" size={24} />
                </button>
                <button onClick={handleAcceptCall} className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center animate-bounce hover:scale-110 transition-transform">
                  <BsTelephoneFill size={24} />
                </button>
              </>
            ) : (
              /* OUTGOING VIEW: Only show a "Cancel" button while dialing */
              <div className="flex flex-col items-center gap-4">
                <button onClick={handleEndCall} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 shadow-2xl shadow-red-500/40">
                  <BsTelephoneFill className="rotate-[135deg]" size={30} />
                </button>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cancel Call</span>
              </div>
            )}
          </>
        ) : (
          /* CONNECTED VIEW (Same as before) */
          <>
            <button onClick={() => setIsSpeakerOn(!isSpeakerOn)} className={`w-12 h-12 rounded-full flex items-center justify-center ${isSpeakerOn ? 'bg-white text-black' : 'bg-white/10'}`}>
              <BsPlayFill className="rotate-90" size={20} />
            </button>
            <button onClick={handleEndCall} className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 shadow-2xl shadow-red-500/50">
              <BsTelephoneFill className="rotate-[135deg]" size={30} />
            </button>
            <button onClick={() => setIsMuted(!isMuted)} className={`w-12 h-12 rounded-full flex items-center justify-center ${isMuted ? 'bg-red-500' : 'bg-white/10'}`}>
              <BsMicFill size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  </div>
)}

    </div>
  );
};