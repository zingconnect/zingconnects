import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsChevronLeft, 
  BsCameraFill, 
  BsCheck2All, 
  BsCloudUpload, 
  BsShieldCheck 
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
    photoUrl: ''
  });

  // 1. Fetch Profile Data
  useEffect(() => {
    const fetchProfile = async () => {
      const token = localStorage.getItem('zingToken');
      const slug = localStorage.getItem('agentSlug');

      if (!token || !slug) return navigate('/');

      try {
        const response = await fetch(`/api/agents/${slug}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Failed to load");
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

  // 2. Handle Update
  const handleUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    const token = localStorage.getItem('zingToken');

    try {
      const response = await fetch(`/api/agents/update-profile`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(agentData)
      });

      if (response.ok) {
        alert("Profile Security Sync Successful");
      } else {
        alert("Sync failed. Check connection.");
      }
    } catch (err) {
      alert("Critical System Error during Update");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFDFD]">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 pb-20">
      {/* HEADER: Mobile & Desktop persistent */}
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
        <form onSubmit={handleUpdate} className="space-y-8 md:space-y-12">
          
          {/* PROFILE PHOTO SECTION */}
          <section className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
            <div className="relative group">
              <div className="w-32 h-32 md:w-48 md:h-48 rounded-[2.5rem] md:rounded-[4rem] bg-gray-100 border-4 border-white shadow-2xl overflow-hidden">
                <img 
                  src={agentData.photoUrl || `https://ui-avatars.com/api/?name=${agentData.firstName}+${agentData.lastName}&background=0e3791&color=fff`} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                />
              </div>
              <label className="absolute bottom-2 right-2 p-3 bg-blue-600 text-white rounded-2xl shadow-lg cursor-pointer hover:scale-110 transition-transform">
                <BsCameraFill size={18} />
                <input type="file" className="hidden" />
              </label>
            </div>
            
            <div className="text-center md:text-left space-y-2">
              <h1 className="text-3xl md:text-5xl font-black tracking-tighter">
                {agentData.firstName} <span className="text-slate-400 font-normal">{agentData.lastName}</span>
              </h1>
              <div className="flex flex-wrap justify-center md:justify-start gap-2">
                <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[9px] font-black uppercase tracking-widest border border-blue-100">
                  {agentData.plan} Account
                </span>
                <span className="px-3 py-1 bg-gray-50 text-gray-400 rounded-full text-[9px] font-black uppercase tracking-widest border border-gray-100">
                  ID: {agentData.slug}
                </span>
              </div>
            </div>
          </section>

          {/* DATA GRID */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Field: Occupation */}
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Professional Title</label>
              <input 
                value={agentData.occupation}
                onChange={(e) => setAgentData({...agentData, occupation: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.5rem] px-6 py-4 text-sm focus:border-blue-600 focus:ring-4 focus:ring-blue-50 transition-all outline-none"
              />
            </div>

            {/* Field: Program */}
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Current Program</label>
              <input 
                value={agentData.program}
                onChange={(e) => setAgentData({...agentData, program: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.5rem] px-6 py-4 text-sm focus:border-blue-600 focus:ring-4 focus:ring-blue-50 transition-all outline-none"
              />
            </div>

            {/* Field: Address */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Office Address</label>
              <input 
                value={agentData.address}
                onChange={(e) => setAgentData({...agentData, address: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[1.5rem] px-6 py-4 text-sm focus:border-blue-600 focus:ring-4 focus:ring-blue-50 transition-all outline-none"
              />
            </div>

            {/* Field: Bio */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-4">Public Bio</label>
              <textarea 
                rows="4"
                value={agentData.bio}
                onChange={(e) => setAgentData({...agentData, bio: e.target.value})}
                className="w-full bg-white border border-gray-100 rounded-[2rem] px-6 py-5 text-sm focus:border-blue-600 focus:ring-4 focus:ring-blue-50 transition-all outline-none resize-none"
              />
            </div>
          </section>

          {/* ACTION FOOTER */}
          <footer className="pt-6 border-t border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="text-center md:text-left">
              <p className="text-[10px] font-black text-blue-950 uppercase tracking-tighter">Biometric & Data Privacy</p>
              <p className="text-[8px] text-gray-400 font-bold uppercase tracking-tighter">Last synced: {new Date().toLocaleDateString()}</p>
            </div>
            
            <button 
              disabled={isSaving}
              type="submit"
              className="w-full md:w-auto px-12 py-5 bg-blue-950 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-800 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? "Syncing..." : "Update Identity"} <BsCloudUpload />
            </button>
          </footer>

        </form>
      </main>
    </div>
  );
};