import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BsShieldLockFill, BsLightningFill, BsEyeFill, BsEyeSlashFill, BsCheckCircleFill } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const AgentSlug = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // --- STATE ---
  const [agentData, setAgentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // --- LOGIN STATE ---
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const fetchAgentProfile = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/agents/${slug}`);
        if (!response.ok) throw new Error('Agent not found');
        const data = await response.json();
        setAgentData(data);
      } catch (err) {
        console.error("Database Error:", err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchAgentProfile();
  }, [slug]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const response = await fetch('/api/agents/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await response.json();
      if (response.ok && data.token) {
        localStorage.setItem('zingToken', data.token);
        localStorage.setItem('agentSlug', data.slug);
        alert("Verification Successful. Entering Portal...");
        setIsLoginOpen(false);
      } else {
        alert(data.message || "Invalid Credentials");
      }
    } catch (err) {
      alert("System connection error");
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !agentData) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 text-center">
      <h1 className="text-xl font-black mb-4">Profile Unavailable</h1>
      <button onClick={() => navigate('/')} className="text-[10px] font-black uppercase tracking-widest text-blue-600 border-b-2 border-blue-600">Return Home</button>
    </div>
  );

  const fullName = `${agentData.firstName} ${agentData.lastName}`;

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 font-sans selection:bg-blue-100">
      
      {/* Dynamic Header */}
      <header className="py-4 px-6 md:px-12 flex justify-between items-center bg-white/70 backdrop-blur-xl fixed top-0 w-full z-40 border-b border-gray-100/50">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-6 md:h-7 w-auto cursor-pointer" onClick={() => navigate('/')} />
        <button 
          onClick={() => setIsLoginOpen(true)}
          className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 hover:text-blue-600 transition-all group"
        >
          <span className="hidden md:inline">Portal Access</span>
          <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-100 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
            <BsShieldLockFill size={14} />
          </div>
        </button>
      </header>

      {/* Main Container */}
      <main className={`transition-all duration-1000 pt-28 md:pt-40 pb-20 px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center ${isLoginOpen ? 'blur-2xl scale-[0.98] pointer-events-none' : ''}`}>
        
        {/* Left Side: Profile Information */}
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2.5 px-4 py-1.5 bg-blue-50/50 border border-blue-100 text-blue-600 rounded-full">
              <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Verified Channel</span>
            </div>
            <h1 className="text-5xl md:text-8xl font-normal tracking-tighter leading-[0.9] text-slate-400">
              Connect with <br />
              <span className="font-black text-blue-950">{fullName}</span>
            </h1>
          </div>

          <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
            {/* Soft Squircle Profile Image */}
          {/* Soft Squircle Profile Image */}
<div className="relative">
  <div className="w-32 h-32 md:w-44 md:h-44 rounded-[3rem] bg-white border-[6px] border-white shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
    {agentData.photoUrl ? (
      <img 
        src={agentData.photoUrl} 
        alt={fullName} 
        className="w-full h-full object-cover"
        // ADD THESE TWO LINES BELOW
        crossOrigin="anonymous"
        referrerPolicy="no-referrer-when-downgrade"
        // Add an error fallback in case the signed URL expires
        onError={(e) => {
          e.target.onerror = null;
          e.target.src = `https://ui-avatars.com/api/?name=${fullName}&background=0e3791&color=fff`;
        }}
      />
    ) : (
      <span className="text-4xl font-black text-blue-100">
{agentData?.firstName?.[0]}{agentData?.lastName?.[0]}
      </span>
    )}
  </div>
  <div className="absolute -bottom-2 -right-2 bg-blue-600 text-white p-2 rounded-full border-4 border-[#FDFDFD]">
    <BsCheckCircleFill size={16} />
  </div>
</div>
            
            <div className="space-y-3 max-w-sm">
  {/* Display Occupation */}
  <h3 className="text-[11px] font-black text-blue-600 uppercase tracking-[0.25em]">
    {agentData.occupation || "Certified Professional"}
  </h3>
  
  {/* Display Program Name explicitly if it exists */}
  {agentData.program && (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Program:</span>
      <span className="text-[10px] font-black text-slate-600 uppercase tracking-tighter bg-slate-100 px-2 py-0.5 rounded">
        {agentData.program}
      </span>
    </div>
  )}

  <p className="text-base md:text-lg font-medium text-slate-500 leading-relaxed italic pt-2">
    "{agentData.bio || "Available for secure professional consultation and strategic inquiry."}"
  </p>
</div>
          </div>

          <div className="pt-6 border-t border-gray-100 flex items-center gap-6">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={`w-10 h-10 rounded-full border-4 border-[#FDFDFD] bg-slate-${i+1}00 shadow-sm`} />
              ))}
            </div>
            <div>
              <p className="text-xs font-black text-blue-950">Active Network</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Encrypted Handshake Protocol</p>
            </div>
          </div>
        </div>

        {/* Right Side: High-End Contact Card */}
        <div className="w-full max-w-lg mx-auto lg:ml-auto animate-in fade-in slide-in-from-right-10 duration-1000 delay-300">
          <div className="bg-white p-8 md:p-12 rounded-[4rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.08)] border border-gray-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 blur-3xl" />
            
            <div className="relative z-10">
              <div className="text-center mb-10">
                <h2 className="text-2xl font-black tracking-tight mb-2 text-blue-950">Secure Inquiry</h2>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Private Communication Line</p>
              </div>
              
              <div className="space-y-5">
                <div className="group">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-4 mb-2 block">Your Identity (Email)</label>
                  <input 
                    type="email" 
                    placeholder="Enter your email to verify..."
                    className="w-full px-8 py-5 bg-gray-50/50 border border-gray-100 rounded-[2rem] text-sm outline-none focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-50 transition-all placeholder:text-gray-300"
                  />
                </div>
                
                <button className="w-full py-6 bg-blue-600 text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-700 hover:shadow-2xl hover:shadow-blue-200 transition-all active:scale-[0.98]">
                  Start Live Session <BsLightningFill />
                </button>
                
                <p className="text-[9px] text-center text-gray-400 font-medium px-8 leading-relaxed">
                  By initializing, you agree to the <span className="text-blue-600 underline cursor-pointer">Security Terms</span> and automated handshake encryption.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* --- AUTH MODAL --- */}
      {isLoginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-blue-950/20 backdrop-blur-2xl animate-in fade-in duration-500">
          <div className="w-full max-w-md bg-white p-12 rounded-[4rem] shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-300">
            <div className="text-center mb-10">
              <div className="w-16 h-16 bg-blue-950 text-white rounded-[1.5rem] flex items-center justify-center mb-6 mx-auto shadow-xl shadow-blue-200">
                <BsShieldLockFill size={24} />
              </div>
              <h2 className="text-2xl font-black text-blue-950">Agent Verification</h2>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Authorized Personnel Only</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <input 
                required type="email" value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Secure ID (Email)"
                className="w-full px-8 py-5 bg-gray-50 border border-transparent rounded-[2rem] text-sm outline-none focus:bg-white focus:border-blue-600 transition-all"
              />
              <div className="relative">
                <input 
                  required type={showPassword ? "text" : "password"} value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Access Key"
                  className="w-full px-8 py-5 bg-gray-50 border border-transparent rounded-[2rem] text-sm outline-none focus:bg-white focus:border-blue-600 transition-all"
                />
                <button 
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600"
                >
                  {showPassword ? <BsEyeSlashFill size={18} /> : <BsEyeFill size={18} />}
                </button>
              </div>
              
              <button 
                disabled={isLoggingIn}
                className="w-full py-6 bg-blue-950 text-white rounded-[2rem] font-black text-[11px] uppercase tracking-[0.2em] hover:bg-black transition-all disabled:opacity-50 shadow-xl shadow-gray-200 mt-4"
              >
                {isLoggingIn ? "Authenticating..." : "Establish Connection"}
              </button>

              <button 
                type="button" 
                onClick={() => setIsLoginOpen(false)}
                className="w-full text-[10px] font-black text-gray-400 uppercase tracking-widest mt-8 hover:text-red-500 transition-colors"
              >
                Terminate Access
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Decorative Footer */}
      <footer className="fixed bottom-8 left-0 w-full px-12 hidden lg:flex justify-between items-center pointer-events-none opacity-30">
        <p className="text-[8px] font-black text-blue-950 uppercase tracking-[0.5em]">System.04 // {slug}</p>
        <p className="text-[8px] font-black text-blue-950 uppercase tracking-[0.5em]">ZingConnect</p>
      </footer>
    </div>
  );
};