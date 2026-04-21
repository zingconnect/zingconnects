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
    gender: '', 
    dob: '',
    address: '',
    photoUrl: '',
    slug: '',
    plan: 'BASIC',
    isSubscribed: false,
    subscriptionAmount: 0,
    subscriptionDate: null,
    expiryDate: null
  });

  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
  const fetchProfile = async () => {
    const token = localStorage.getItem('agentToken');
    if (!token) return navigate('/');

    try {
      const response = await fetch('/api/agents/profile/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error("Failed to load profile");
      
      const result = await response.json();
      
      if (result.success) {
        setAgentData(prevData => ({
          ...prevData,
          ...result
        })); 
      }
    } catch (err) {
      console.error("Profile Fetch Error:", err);
      if (err.message === "Failed to load profile") {
         localStorage.removeItem('agentToken');
         navigate('/');
      }
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
    const token = localStorage.getItem('agentToken');

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
        const errorData = await response.json();
        alert(errorData.message || "Error updating profile");
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
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 pb-20 font-sans antialiased">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-4 md:px-12 flex justify-between items-center">
        <button 
          onClick={() => navigate('/agent/dashboard')}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-all"
        >
          <BsChevronLeft size={14} /> <span className="hidden xs:inline">Back to Portal</span>
        </button>
        <div className="flex items-center gap-2">
          <BsShieldCheck className="text-blue-600" size={16} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-900">Secure Profile</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 md:mt-16 px-4">
        
        {/* --- SUBSCRIPTION STATUS CARDS (Optimized for Mobile) --- */}
        <section className="mb-10 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-blue-900 text-white p-5 rounded-[1.5rem] shadow-lg flex flex-col justify-between relative overflow-hidden min-h-[110px]">
            <BsCashStack className="absolute -right-2 -bottom-2 text-white/10" size={70} />
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest opacity-60 mb-1">Active Plan</p>
              <h2 className="text-xl font-black uppercase leading-none">{agentData.plan}</h2>
            </div>
            <p className="text-lg font-bold mt-2">${agentData.subscriptionAmount || 0}</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-[1.5rem] shadow-sm flex flex-col justify-center min-h-[110px]">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Activation Date</p>
            <div className="flex items-center gap-2 text-blue-900">
              <BsCalendarCheck size={12} className="shrink-0" />
              <span className="text-xs font-bold break-words">{formatDate(agentData.subscriptionDate)}</span>
            </div>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-[1.5rem] shadow-sm flex flex-col justify-between min-h-[110px]">
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Expiry Date</p>
              <div className="flex items-center gap-2 text-red-500">
                <BsHourglassSplit size={12} className="shrink-0" />
                <span className="text-xs font-bold break-words">{formatDate(agentData.expiryDate)}</span>
              </div>
            </div>
            {agentData.isSubscribed ? (
                <span className="mt-2 text-[7px] font-black uppercase text-green-500 tracking-widest">● Active</span>
            ) : (
                <span className="mt-2 text-[7px] font-black uppercase text-red-500 tracking-widest">● Expired</span>
            )}
          </div>
        </section>

        <form onSubmit={handleUpdate} className="space-y-8">
          {/* PROFILE PHOTO SECTION */}
          <section className="flex flex-col md:flex-row items-center gap-6 md:gap-10 text-center md:text-left">
            <div className="relative group">
              <div className="w-28 h-28 md:w-36 md:h-36 rounded-[2rem] bg-gray-100 border-4 border-white shadow-xl overflow-hidden">
                <img 
                  src={agentData.photoUrl || `https://ui-avatars.com/api/?name=${agentData.firstName}+${agentData.lastName}&background=0e3791&color=fff`} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              </div>
              <label className="absolute bottom-0 right-0 p-2 bg-blue-600 text-white rounded-lg shadow-lg cursor-pointer hover:scale-105 transition-transform">
                <BsCameraFill size={14} />
                <input type="file" className="hidden" />
              </label>
            </div>
            
            <div className="max-w-xs">
              <h1 className="text-2xl md:text-3xl font-black tracking-tighter leading-tight">
                {agentData.firstName} <span className="text-slate-400 font-normal">{agentData.lastName}</span>
              </h1>
              <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-1">ID: {agentData.slug || '---'}</p>
            </div>
          </section>

          {/* IDENTITY DATA FIELDS */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 ml-4">Professional Title</label>
              <input 
                value={agentData.occupation || ''}
                onChange={(e) => setAgentData({...agentData, occupation: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 ml-4">Current Program</label>
              <input 
                value={agentData.program || ''}
                onChange={(e) => setAgentData({...agentData, program: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 ml-4">Office Address</label>
              <input 
                value={agentData.address || ''}
                onChange={(e) => setAgentData({...agentData, address: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 ml-4">Public Bio</label>
              <textarea 
                rows="3"
                value={agentData.bio || ''}
                onChange={(e) => setAgentData({...agentData, bio: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-2xl px-5 py-3.5 text-sm focus:border-blue-600 outline-none transition-all resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 ml-4">Gender</label>
              <div className="relative">
                <select 
                  value={agentData.gender ? agentData.gender.toLowerCase() : ""} 
                  onChange={(e) => setAgentData({...agentData, gender: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm focus:border-blue-600 outline-none transition-all appearance-none capitalize"
                >
                  <option value="">Select Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                  <svg className="fill-current h-4 w-4" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 ml-4">Date of Birth</label>
              <input 
                type="date"
                value={agentData.dob ? new Date(agentData.dob).toISOString().slice(0, 10) : ''}
                onChange={(e) => setAgentData({ ...agentData, dob: e.target.value })}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>
          </section>

          {/* SECURITY CREDENTIALS SECTION */}
          <section className="bg-gray-50/50 p-6 rounded-[2rem] border border-dashed border-gray-200">
            <div className="flex items-center gap-2 mb-5">
              <BsKeyFill className="text-blue-600" size={16} />
              <h3 className="text-[9px] font-black uppercase tracking-[0.15em] text-blue-900">Security Credentials</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input 
                type="password" 
                placeholder="Old Password"
                value={passwordData.oldPassword}
                onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm outline-none focus:border-blue-600 transition-all"
              />
              <input 
                type="password" 
                placeholder="New Password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm outline-none focus:border-blue-600 transition-all"
              />
              <input 
                type="password" 
                placeholder="Confirm New"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-xl px-5 py-3.5 text-sm outline-none focus:border-blue-600 transition-all"
              />
            </div>
          </section>

          <footer className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="text-center sm:text-left">
              <p className="text-[9px] font-black text-blue-950 uppercase tracking-tighter">Biometric Security Sync</p>
              <p className="text-[7px] text-gray-400 font-bold uppercase tracking-tighter">Verified • {new Date().toLocaleDateString()}</p>
            </div>
            
            <button 
              disabled={isSaving}
              type="submit"
              className="w-full sm:w-auto px-8 py-3.5 bg-blue-950 text-white rounded-xl font-black text-[9px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-800 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? "Syncing..." : "Update Identity"} <BsCloudUpload />
            </button>
          </footer>
        </form>
      </main>
    </div>
  );
};