import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsChevronLeft, 
  BsCameraFill, 
  BsCloudUpload, 
  BsShieldCheck,
  BsCalendarCheck,
  BsCashStack,
  BsHourglassSplit,
  BsKeyFill
} from 'react-icons/bs';

export const AgentProfile = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [agentData, setAgentData] = useState({
    firstName: '',
    lastName: '',
    occupation: '',
    program: '',
    bio: '',
    address: '',
    photoUrl: '',
    slug: '',
    plan: 'BASIC',
    isSubscribed: false,
    subscriptionAmount: 0,
    subscriptionDate: null,
    expiryDate: null
  });

  // Password State
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    const fetchProfile = async () => {
      const token = localStorage.getItem('zingToken');
      if (!token) return navigate('/');

      try {
        const response = await fetch('/api/agents/profile/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Failed to load profile");
        const data = await response.json();
        setAgentData(data);
      } catch (err) {
        console.error("Profile Fetch Error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [navigate]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (passwordData.newPassword && passwordData.newPassword !== passwordData.confirmPassword) {
      return alert("New passwords do not match!");
    }

    setIsSaving(true);
    const token = localStorage.getItem('zingToken');

    try {
      const response = await fetch(`/api/agents/update-profile`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          ...agentData,
          ...passwordData
        })
      });

      if (response.ok) {
        alert("Identity & Security Sync Successful");
        setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        const error = await response.json();
        alert(error.message || "Update failed");
      }
    } catch (err) {
      alert("Error updating profile");
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFDFD]">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 pb-10 font-sans antialiased overflow-x-hidden">
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100 px-4 py-3 md:py-4 md:px-12 flex justify-between items-center">
        <button 
          onClick={() => navigate('/agent/dashboard')}
          className="flex items-center gap-1.5 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-all"
        >
          <BsChevronLeft size={12} /> BACK
        </button>
        <div className="flex items-center gap-2">
          <BsShieldCheck className="text-blue-600" size={14} />
          <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-blue-900">Secure Profile</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 md:mt-12 px-4">
        
        {/* --- SUBSCRIPTION STATUS CARDS (Optimized for Mobile) --- */}
        <section className="mb-8 grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-blue-950 text-white p-4 md:p-6 rounded-2xl shadow-lg flex flex-col justify-between relative overflow-hidden">
            <BsCashStack className="absolute -right-2 -bottom-2 text-white/10" size={60} />
            <div>
              <p className="text-[7px] md:text-[9px] font-black uppercase tracking-widest opacity-60 mb-0.5">Active Plan</p>
              <h2 className="text-sm md:text-2xl font-black uppercase">{agentData.plan}</h2>
            </div>
            <p className="text-xs md:text-xl font-bold mt-2">${agentData.subscriptionAmount || 0}</p>
          </div>

          <div className="bg-white border border-gray-100 p-4 md:p-6 rounded-2xl shadow-sm flex flex-col justify-between">
            <div>
              <p className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Expiration</p>
              <div className="flex items-center gap-1.5 text-red-500">
                <BsHourglassSplit size={12} />
                <span className="text-[10px] md:text-sm font-bold">{formatDate(agentData.expiryDate)}</span>
              </div>
            </div>
            <span className={`text-[7px] font-black uppercase tracking-widest mt-2 ${agentData.isSubscribed ? 'text-green-500' : 'text-red-500'}`}>
              ● {agentData.isSubscribed ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div className="hidden md:flex bg-white border border-gray-100 p-6 rounded-2xl shadow-sm flex-col justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Activation Date</p>
              <div className="flex items-center gap-2 text-blue-900">
                <BsCalendarCheck size={14} />
                <span className="text-sm font-bold">{formatDate(agentData.subscriptionDate)}</span>
              </div>
            </div>
          </div>
        </section>

        <form onSubmit={handleUpdate} className="space-y-6 md:space-y-8">
          {/* PROFILE PHOTO SECTION */}
          <section className="flex flex-col md:flex-row items-center gap-4 md:gap-10">
            <div className="relative">
              <div className="w-24 h-24 md:w-36 md:h-36 rounded-3xl md:rounded-[2.5rem] bg-gray-100 border-2 border-white shadow-xl overflow-hidden">
                <img 
                  src={agentData.photoUrl || `https://ui-avatars.com/api/?name=${agentData.firstName}+${agentData.lastName}&background=0e3791&color=fff`} 
                  alt="Agent" 
                  className="w-full h-full object-cover"
                />
              </div>
              <label className="absolute -bottom-1 -right-1 p-2 bg-blue-600 text-white rounded-xl shadow-lg cursor-pointer hover:scale-110 transition-transform">
                <BsCameraFill size={14} />
                <input type="file" className="hidden" />
              </label>
            </div>
            
            <div className="text-center md:text-left">
              <h1 className="text-2xl md:text-4xl font-black tracking-tighter">
                {agentData.firstName} <span className="text-slate-400 font-normal">{agentData.lastName}</span>
              </h1>
              <p className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">ID: {agentData.slug || '---'}</p>
            </div>
          </section>

          {/* IDENTITY DATA FIELDS */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            <div className="space-y-1.5">
              <label className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-gray-400 ml-2">Professional Title</label>
              <input 
                value={agentData.occupation}
                onChange={(e) => setAgentData({...agentData, occupation: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 md:py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all shadow-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-gray-400 ml-2">Program</label>
              <input 
                value={agentData.program}
                onChange={(e) => setAgentData({...agentData, program: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 md:py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all shadow-sm"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-gray-400 ml-2">Office Address</label>
              <input 
                value={agentData.address}
                onChange={(e) => setAgentData({...agentData, address: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 md:py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all shadow-sm"
              />
            </div>
          </section>

          {/* SECURITY / PASSWORD SECTION */}
          <section className="bg-gray-50/50 p-4 md:p-8 rounded-3xl border border-dashed border-gray-200">
            <div className="flex items-center gap-2 mb-4 md:mb-6">
              <BsKeyFill className="text-blue-600" />
              <h3 className="text-[9px] md:text-[11px] font-black uppercase tracking-[0.2em]">Security Credentials</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <div className="space-y-1">
                <input 
                  type="password" 
                  placeholder="Old Password"
                  value={passwordData.oldPassword}
                  onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 text-base md:text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div className="space-y-1">
                <input 
                  type="password" 
                  placeholder="New Password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 text-base md:text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div className="space-y-1">
                <input 
                  type="password" 
                  placeholder="Confirm New"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-4 py-3 text-base md:text-sm outline-none focus:border-blue-600"
                />
              </div>
            </div>
            <p className="text-[8px] text-gray-400 mt-3 uppercase font-bold tracking-tighter">Leave blank to keep current password</p>
          </section>

          <footer className="pt-4 flex flex-col items-center">
            <button 
              disabled={isSaving}
              type="submit"
              className="w-full md:w-auto md:px-20 py-4 bg-blue-950 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-3 hover:bg-blue-900 transition-all active:scale-[0.98] disabled:opacity-50 shadow-xl"
            >
              {isSaving ? "SYNCING..." : "UPDATE IDENTITY"} <BsCloudUpload size={16} />
            </button>
            <p className="text-[8px] text-gray-400 mt-4 uppercase font-bold tracking-widest italic">Identity Verification Secured by ZingConnect</p>
          </footer>
        </form>
      </main>
    </div>
  );
};