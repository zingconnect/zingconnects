import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsTelephoneFill, 
  BsPlusLg, 
  BsSendFill, 
  BsCheckAll,
  BsChevronLeft,
  BsShieldLockFill,
  BsGearFill,
  BsArrowRight,
  BsCameraFill
} from 'react-icons/bs';

export const UserDashboard = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  // --- STATE ---
  const [agent, setAgent] = useState(null);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  
  // Onboarding & Photo State
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
    gender: '',
    city: '',
    state: ''
  });

const getStatusInfo = (agentData) => {
  if (!agentData) return { isOnline: false, label: "Connecting..." };
  if (agentData.status === 'online') {
    return { isOnline: true, label: "Online" };
  }
  if (agentData.lastSeenText) {
    return { isOnline: false, label: agentData.lastSeenText };
  }
  if (agentData.lastActive) {
    const diff = Math.floor((new Date() - new Date(agentData.lastActive)) / 1000);
    if (diff < 120) return { isOnline: true, label: "Online" };
  }

  return { isOnline: false, label: "Offline" };
};

  // --- INITIAL DATA FETCH ---
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
      // We set that directly into the state
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

  return () => {
    clearInterval(interval);
  };
}, [navigate]);

const agentStatus = getStatusInfo(agent);

  // --- PHOTO HANDLERS ---
  const handlePhotoClick = () => fileInputRef.current.click();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
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

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    
    const msg = {
      id: Date.now(),
      text: newMessage,
      sender: 'user',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages([...messages, msg]);
    setNewMessage('');
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
                {/* Status Dot in Sidebar */}
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
                  {/* Add this inside the onboarding form */}
<div className="space-y-1">
  <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Gender</label>
  <select 
    required 
    className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none appearance-none"
    onChange={e => setFormData({...formData, gender: e.target.value})}
    value={formData.gender}
  >
    <option value="" disabled>Select Gender</option>
    <option value="male">Male</option>
    <option value="female">Female</option>
    <option value="prefer-not-to-say">Prefer not to say</option>
  </select>
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

              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase ml-1">Date of Birth</label>
                <input required type="date" className="w-full bg-gray-50 border border-gray-100 p-3 md:p-4 rounded-xl text-xs md:text-sm outline-none" onChange={e => setFormData({...formData, dob: e.target.value})} />
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
            <BsTelephoneFill className="cursor-pointer hover:text-gray-700 transition-colors" size={16} />
            <BsGearFill className="cursor-pointer hover:text-gray-700 transition-colors" size={18} />
          </div>
        </header>

        <main className="flex-1 relative overflow-y-auto bg-[#efeae2] p-4 md:px-[15%] lg:px-[25%] flex flex-col space-y-2 scrollbar-hide">
          <div className="absolute inset-0 opacity-[0.05] pointer-events-none" 
               style={{ backgroundImage: "url('https://w0.peakpx.com/wallpaper/580/678/OH-wallpaper-whatsapp-dark-mode.jpg')" }} />

          <div className="self-center z-10 my-4 px-4 py-1.5 bg-[#fff9c2] rounded-lg shadow-sm border border-yellow-100 flex items-center gap-2 max-w-[90%]">
            <BsShieldLockFill size={10} className="text-gray-600" />
            <p className="text-[9px] md:text-[10px] text-gray-600 text-center font-medium leading-tight">
              Messages are end-to-end encrypted. No one outside of this chat can read them.
            </p>
          </div>

          {messages.map((m) => (
            <div key={m.id} className={`max-w-[85%] md:max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm relative z-10 animate-in fade-in slide-in-from-bottom-2 ${
                m.sender === 'user' ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
              }`}>
              <p className="text-[12px] md:text-[14px] text-[#303030] leading-relaxed pr-8">{m.text}</p>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <span className="text-[8px] md:text-[9px] text-gray-400 font-medium">{m.time}</span>
                {m.sender === 'user' && <BsCheckAll size={16} className="text-blue-400" />}
              </div>
            </div>
          ))}
        </main>

        <footer className="shrink-0 min-h-[65px] md:min-h-[75px] bg-[#f0f2f5] px-2 md:px-6 py-3 flex items-center gap-2 md:gap-4 z-20 border-t border-gray-200 pb-safe">
          <div className="flex gap-3 md:gap-5 text-gray-500">
            <BsPlusLg className="cursor-pointer hover:text-gray-700" size={20} />
          </div>
          
          <form onSubmit={handleSendMessage} className="flex-1">
            <input 
              value={newMessage} 
              onChange={(e) => setNewMessage(e.target.value)} 
              placeholder="Type your secure message" 
              className="w-full bg-white px-4 py-2.5 md:py-3 rounded-full text-[14px] outline-none shadow-sm border border-gray-100 focus:ring-1 ring-blue-500/20" 
            />
          </form>

          <div className="w-10 md:w-12 flex justify-center items-center">
            <button 
              type="submit" 
              onClick={handleSendMessage} 
              className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center transition-all ${
                newMessage.trim() ? 'bg-blue-600 text-white shadow-lg' : 'bg-white text-gray-500 border border-gray-100'
              }`}
            >
              <BsSendFill size={16} className={newMessage.trim() ? "ml-0.5" : ""} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};