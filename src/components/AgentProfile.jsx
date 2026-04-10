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

  // Password Update State
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
    const result = await response.json();
    if (result.success) {
      setAgentData(result); 
    } else {
      console.error("Backend error:", result.message);
    }
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
    
    // Validate password match if user is trying to change it
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
        // Clear password fields after success
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
      month: 'long',
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
          <BsChevronLeft size={14} /> Back to Portal
        </button>
        <div className="flex items-center gap-2">
          <BsShieldCheck className="text-blue-600" size={16} />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-900">Secure Profile Editor</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-8 md:mt-16 px-4">
        
        {/* --- SUBSCRIPTION STATUS CARD --- */}
        <section className="mb-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-900 text-white p-6 rounded-[2rem] shadow-xl flex flex-col justify-between relative overflow-hidden">
            <BsCashStack className="absolute -right-4 -bottom-4 text-white/10" size={100} />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-1">Active Plan</p>
              <h2 className="text-2xl font-black uppercase">{agentData.plan}</h2>
            </div>
            <p className="text-xl font-bold mt-4">${agentData.subscriptionAmount || 0}</p>
          </div>

          <div className="bg-white border border-gray-100 p-6 rounded-[2rem] shadow-sm flex flex-col justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Activation Date</p>
              <div className="flex items-center gap-2 text-blue-900">
                <BsCalendarCheck size={14} />
                <span className="text-sm font-bold">{formatDate(agentData.subscriptionDate)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-100 p-6 rounded-[2rem] shadow-sm flex flex-col justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Expiry Date</p>
              <div className="flex items-center gap-2 text-red-500">
                <BsHourglassSplit size={14} />
                <span className="text-sm font-bold">{formatDate(agentData.expiryDate)}</span>
              </div>
            </div>
            {agentData.isSubscribed ? (
                <span className="mt-2 text-[8px] font-black uppercase text-green-500 tracking-widest">● Status: Active</span>
            ) : (
                <span className="mt-2 text-[8px] font-black uppercase text-red-500 tracking-widest">● Status: Expired</span>
            )}
          </div>
        </section>

        <form onSubmit={handleUpdate} className="space-y-8">
          {/* PROFILE PHOTO SECTION */}
          <section className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
            <div className="relative group">
              <div className="w-32 h-32 md:w-40 md:h-40 rounded-[2.5rem] bg-gray-100 border-4 border-white shadow-2xl overflow-hidden">
                <img 
                  src={agentData.photoUrl || `https://ui-avatars.com/api/?name=${agentData.firstName}+${agentData.lastName}&background=0e3791&color=fff`} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              </div>
              <label className="absolute bottom-1 right-1 p-2.5 bg-blue-600 text-white rounded-xl shadow-lg cursor-pointer hover:scale-110 transition-transform">
                <BsCameraFill size={16} />
                <input type="file" className="hidden" />
              </label>
            </div>
            
            <div className="text-center md:text-left">
              <h1 className="text-3xl md:text-4xl font-black tracking-tighter">
                {agentData.firstName} <span className="text-slate-400 font-normal">{agentData.lastName}</span>
              </h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Agent ID: {agentData.slug || '---'}</p>
            </div>
          </section>

          {/* IDENTITY DATA FIELDS */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Professional Title</label>
              <input 
                value={agentData.occupation}
                onChange={(e) => setAgentData({...agentData, occupation: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.2rem] px-6 py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Current Program</label>
              <input 
                value={agentData.program}
                onChange={(e) => setAgentData({...agentData, program: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.2rem] px-6 py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Office Address</label>
              <input 
                value={agentData.address}
                onChange={(e) => setAgentData({...agentData, address: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.2rem] px-6 py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Public Bio</label>
              <textarea 
                rows="3"
                value={agentData.bio}
                onChange={(e) => setAgentData({...agentData, bio: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.5rem] px-6 py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all resize-none"
              />
            </div>
  {/* NEW: Gender Field */}
<div className="space-y-2">
  <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Gender</label>
  <div className="relative">
    <select 
      /* Force lowercase to match the DB "male" or "female" */
      value={agentData.gender ? agentData.gender.toLowerCase() : ""} 
      onChange={(e) => setAgentData({...agentData, gender: e.target.value})}
      className="w-full bg-white border border-gray-100 rounded-[1.2rem] px-6 py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all appearance-none capitalize"
    >
      <option value="">Select Gender</option>
      <option value="male">Male</option>
      <option value="female">Female</option>
      <option value="other">Other</option>
    </select>
    
    {/* Optional: Add a small dropdown arrow icon since appearance-none removes it */}
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-6 text-gray-400">
      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
      </svg>
    </div>
  </div>
</div>

  {/* NEW: Date of Birth Field */}
<div className="space-y-2">
  <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Date of Birth</label>
  <input 
    type="date"
    /* The value MUST be YYYY-MM-DD. 
       Using .slice(0, 10) is a safer way to get the date part of an ISO string.
    */
    value={
      agentData.dob 
        ? new Date(agentData.dob).toISOString().slice(0, 10) 
        : ''
    }
    onChange={(e) => {
      const selectedDate = e.target.value;
      setAgentData({ ...agentData, dob: selectedDate });
    }}
    className="w-full bg-white border border-gray-100 rounded-[1.2rem] px-6 py-4 text-base md:text-sm focus:border-blue-600 outline-none transition-all"
  />
</div>
          </section>

          {/* SECURITY CREDENTIALS SECTION */}
          <section className="bg-gray-50/50 p-6 md:p-8 rounded-[2.5rem] border border-dashed border-gray-200">
            <div className="flex items-center gap-2 mb-6">
              <BsKeyFill className="text-blue-600" size={18} />
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-900">Security Credentials</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <input 
                  type="password" 
                  placeholder="Old Password"
                  value={passwordData.oldPassword}
                  onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-6 py-4 text-base md:text-sm outline-none focus:border-blue-600 transition-all"
                />
              </div>
              <div className="space-y-2">
                <input 
                  type="password" 
                  placeholder="New Password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-6 py-4 text-base md:text-sm outline-none focus:border-blue-600 transition-all"
                />
              </div>
              <div className="space-y-2">
                <input 
                  type="password" 
                  placeholder="Confirm New"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                  className="w-full bg-white border border-gray-100 rounded-xl px-6 py-4 text-base md:text-sm outline-none focus:border-blue-600 transition-all"
                />
              </div>
            </div>
            <p className="text-[8px] text-gray-400 mt-4 uppercase font-bold tracking-widest text-center md:text-left">
              Leave password fields empty if you do not wish to change your security key.
            </p>
          </section>

          <footer className="pt-6 border-t border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="text-center md:text-left">
              <p className="text-[10px] font-black text-blue-950 uppercase tracking-tighter">Biometric Security Sync</p>
              <p className="text-[8px] text-gray-400 font-bold uppercase tracking-tighter">Identity Verified • {new Date().toLocaleDateString()}</p>
            </div>
            
            <button 
              disabled={isSaving}
              type="submit"
              className="w-full md:w-auto px-10 py-4 bg-blue-950 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-800 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? "Syncing..." : "Update Identity"} <BsCloudUpload />
            </button>
          </footer>
        </form>
      </main>
    </div>
  );
};