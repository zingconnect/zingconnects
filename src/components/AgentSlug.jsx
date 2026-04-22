import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BsShieldLockFill, BsLightningFill, BsEyeFill, BsEyeSlashFill, BsCheckCircleFill } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const AgentSlug = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  
  // --- UI & DATA STATES ---
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agentData, setAgentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // --- AUTH STATES ---
  const [userEmail, setUserEmail] = useState(''); // Inquiry email for Users
  const [loginEmail, setLoginEmail] = useState(''); // Portal email for Agents
  const [loginPassword, setLoginPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // --- REMEMBER ME STATES ---
  const [rememberUser, setRememberUser] = useState(false);
  const [rememberAgent, setRememberAgent] = useState(false);

  // Fetch Agent Profile on Load
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

  // Load Remembered Credentials
  useEffect(() => {
    const savedUserEmail = localStorage.getItem('rememberedUserEmail');
    const savedAgentEmail = localStorage.getItem('rememberedAgentEmail');
    
    if (savedUserEmail) {
      setUserEmail(savedUserEmail);
      setRememberUser(true);
    }
    if (savedAgentEmail) {
      setLoginEmail(savedAgentEmail);
      setRememberAgent(true);
    }
  }, []);

  // --- HANDLER 1: USER HANDSHAKE ---
  const handleUserInquiry = async (e) => {
    e.preventDefault();
    if (!userEmail) return alert("Please enter your email to continue.");
    
    setIsProcessing(true);
    try {
      const response = await fetch('/api/users/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: userEmail, 
          agentId: agentData._id,
          agentSlug: slug 
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Handle Remember Me logic
        if (rememberUser) {
          localStorage.setItem('rememberedUserEmail', userEmail);
        } else {
          localStorage.removeItem('rememberedUserEmail');
        }

        localStorage.setItem('userToken', data.token);
        localStorage.setItem('userEmail', userEmail);
        alert("Verification Successful. Opening User Dashboard...");

        localStorage.setItem('userToken', data.token);
  
  // 🔍 ADD THIS DEBUG LINE
  const decoded = JSON.parse(atob(data.token.split('.')[1]));
  console.log("DEBUG: Handshake successful. Logged in User ID:", decoded.id || decoded._id);
  
        navigate('/user/dashboard');
      } else {
        alert(data.message || "Connection failed.");
      }
    } catch (err) {
      alert("System connection error. Please check your network.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- HANDLER 2: AGENT PORTAL LOGIN ---
  const handleAgentLogin = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      const response = await fetch('/api/agents/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      
      const data = await response.json();
      
      if (response.ok && data.token) {
        // Handle Remember Me logic
        if (rememberAgent) {
          localStorage.setItem('rememberedAgentEmail', loginEmail);
        } else {
          localStorage.removeItem('rememberedAgentEmail');
        }

        localStorage.setItem('agentToken', data.token);
        localStorage.setItem('agentSlug', data.slug);
        localStorage.setItem('isSubscribed', data.isSubscribed); 
        localStorage.setItem('agentPlan', data.plan);

        alert("Agent Verified. Entering Portal...");
        setIsLoginOpen(false);
        navigate('/agent/dashboard');
      } 
      else if (response.status === 403 && data.needsVerification) {
        alert(data.message);
        navigate('/verify-otp', { state: { email: loginEmail } });
      } 
      else {
        alert(data.message || "Invalid Agent Credentials");
      }
    } catch (err) {
      alert("Portal connection error");
    } finally {
      setIsProcessing(false);
    }
  };
  
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !agentData) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 text-center">
      <h1 className="text-lg font-black mb-4 text-blue-950">Profile Unavailable</h1>
      <button onClick={() => navigate('/')} className="text-[10px] font-black uppercase tracking-widest text-blue-600 border-b-2 border-blue-600">Return Home</button>
    </div>
  );

  const fullName = `${agentData.firstName} ${agentData.lastName}`;

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 font-sans selection:bg-blue-100 overflow-x-hidden">
      
      <header className="py-3 px-4 md:py-4 md:px-12 flex justify-between items-center bg-white/70 backdrop-blur-xl fixed top-0 w-full z-40 border-b border-gray-100/50">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-5 md:h-7 w-auto cursor-pointer" onClick={() => navigate('/')} />
        <button 
          onClick={() => setIsLoginOpen(true)}
          className="flex items-center gap-2 md:gap-3 text-[8px] md:text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 hover:text-blue-600 transition-all group"
        >
          <span className="hidden sm:inline">Portal Access</span>
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg md:rounded-xl bg-gray-50 flex items-center justify-center border border-gray-100 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
            <BsShieldLockFill size={12} className="md:size-[14px]" />
          </div>
        </button>
      </header>

      <main className={`transition-all duration-1000 pt-24 md:pt-40 pb-10 px-4 md:px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 md:gap-16 items-start md:items-center ${isLoginOpen ? 'blur-2xl scale-[0.98] pointer-events-none' : ''}`}>
        
        <div className="w-full max-w-lg mx-auto lg:ml-auto order-first lg:order-last animate-in fade-in slide-in-from-top-10 lg:slide-in-from-right-10 duration-1000 delay-300">
          <div className="bg-white p-6 md:p-12 rounded-[2.5rem] md:rounded-[4rem] shadow-xl lg:shadow-[0_40px_100px_-20px_rgba(0,0,0,0.08)] border border-gray-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50/50 rounded-full -mr-12 -mt-12 blur-2xl" />
            
            <form onSubmit={handleUserInquiry} className="relative z-10">
              <div className="text-center mb-6 md:mb-10">
                <h2 className="text-xl md:text-2xl font-black tracking-tight mb-1 text-blue-950">Secure Inquiry</h2>
                <p className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Private Communication Line</p>
              </div>
              
              <div className="space-y-4 md:space-y-5">
                <div className="group">
                  <label className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest ml-4 mb-2 block">Your Identity (Email)</label>
                  <input 
                    required
                    type="email" 
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="Enter email to verify..."
                    className="w-full px-6 py-4 md:px-8 md:py-5 bg-gray-50/50 border border-gray-100 rounded-[1.5rem] md:rounded-[2rem] text-xs md:text-sm outline-none focus:bg-white focus:border-blue-600 focus:ring-4 focus:ring-blue-50 transition-all"
                  />
                  {/* User Remember Me */}
                  <div className="flex items-center gap-2 ml-4 mt-3">
                    <input 
                      type="checkbox" 
                      id="rememberUser"
                      checked={rememberUser}
                      onChange={(e) => setRememberUser(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <label htmlFor="rememberUser" className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest cursor-pointer">
                      Remember Identity
                    </label>
                  </div>
                </div>
                
                <button 
                  type="submit"
                  disabled={isProcessing}
                  className="w-full py-5 md:py-6 bg-blue-600 text-white rounded-[1.5rem] md:rounded-[2rem] font-black text-[10px] md:text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isProcessing ? "Connecting..." : "Start Live Session"} <BsLightningFill />
                </button>
                
                <p className="text-[8px] text-center text-gray-400 font-medium px-4 leading-relaxed">
                  By initializing, you agree to the <span className="text-blue-600 underline cursor-pointer">Security Terms</span>.
                </p>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-8 md:space-y-10 animate-in fade-in slide-in-from-bottom-10 duration-1000">
          <div className="space-y-3 md:space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50/50 border border-blue-100 text-blue-600 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
              <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest">Verified Channel</span>
            </div>
            <h1 className="text-3xl md:text-6xl lg:text-8xl font-normal tracking-tighter leading-[1] md:leading-[0.9] text-slate-400 text-center lg:text-left">
              Connect with <br />
              <span className="font-black text-blue-950">{fullName}</span>
            </h1>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-6 md:gap-8">
            <div className="relative">
              <div className="w-24 h-24 md:w-44 md:h-44 rounded-[2rem] md:rounded-[3rem] bg-white border-[4px] md:border-[6px] border-white shadow-lg overflow-hidden flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
                {agentData.photoUrl ? (
                  <img 
  src={agentData.photoUrl} 
  alt={fullName} 
  className="w-full h-full object-cover"
  crossOrigin="anonymous" 
  referrerPolicy="no-referrer-when-downgrade"
  onError={(e) => {
    e.target.onerror = null; 
    e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=0e3791&color=fff`;
  }}
/>
                ) : (
                  <span className="text-2xl md:text-4xl font-black text-blue-100">
                    {agentData?.firstName?.[0]}{agentData?.lastName?.[0]}
                  </span>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 md:-bottom-2 md:-right-2 bg-blue-600 text-white p-1.5 md:p-2 rounded-full border-2 md:border-4 border-[#FDFDFD]">
                <BsCheckCircleFill className="size-3 md:size-4" />
              </div>
            </div>
            
            <div className="space-y-2 md:space-y-3 max-w-sm text-center sm:text-left">
              <h3 className="text-[9px] md:text-[11px] font-black text-blue-600 uppercase tracking-[0.2em]">
                {agentData.occupation || "Certified Professional"}
              </h3>
              
              {agentData.program && (
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <span className="text-[8px] md:text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Program:</span>
                  <span className="text-[8px] md:text-[10px] font-black text-slate-600 uppercase tracking-tighter bg-slate-100 px-2 py-0.5 rounded">
                    {agentData.program}
                  </span>
                </div>
              )}

              <p className="text-sm md:text-lg font-medium text-slate-500 leading-relaxed italic">
                "{agentData.bio || "Available for secure professional consultation."}"
              </p>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100 flex items-center justify-center lg:justify-start gap-4 md:gap-6">
            <div className="flex -space-x-2 md:-space-x-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 md:border-4 border-[#FDFDFD] bg-blue-${(i+1)*100} shadow-sm`} />
              ))}
            </div>
            <div>
              <p className="text-[10px] md:text-xs font-black text-blue-950 uppercase tracking-tighter">Active Network</p>
              <p className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Encrypted Protocol</p>
            </div>
          </div>
        </div>
      </main>

      {isLoginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-blue-950/20 backdrop-blur-2xl">
          <div className="w-full max-w-sm bg-white p-8 md:p-12 rounded-[3rem] shadow-2xl border border-gray-100">
            <div className="text-center mb-8">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-950 text-white rounded-[1rem] md:rounded-[1.5rem] flex items-center justify-center mb-4 mx-auto shadow-xl">
                <BsShieldLockFill size={20} />
              </div>
              <h2 className="text-xl font-black text-blue-950">Agent Verification</h2>
            </div>

            <form onSubmit={handleAgentLogin} className="space-y-4">
              <input 
                required type="email" value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Agent Secure ID"
                className="w-full px-6 py-4 bg-gray-50 border border-transparent rounded-[1.5rem] text-xs outline-none focus:border-blue-600 transition-all"
              />
              <div className="relative">
                <input 
                  required type={showPassword ? "text" : "password"} value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Access Key"
                  className="w-full px-6 py-4 bg-gray-50 border border-transparent rounded-[1.5rem] text-xs outline-none focus:border-blue-600 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPassword ? <BsEyeSlashFill size={16} /> : <BsEyeFill size={16} />}
                </button>
              </div>

              {/* Agent Remember Me */}
              <div className="flex items-center gap-2 ml-2 mt-1">
                <input 
                  type="checkbox" 
                  id="rememberAgent"
                  checked={rememberAgent}
                  onChange={(e) => setRememberAgent(e.target.checked)}
                  className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="rememberAgent" className="text-[9px] font-black text-gray-400 uppercase tracking-widest cursor-pointer">
                  Remember Access Key ID
                </label>
              </div>

              <button disabled={isProcessing} className="w-full py-5 bg-blue-950 text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-lg mt-2 disabled:opacity-50">
                {isProcessing ? "Verifying..." : "Establish Connection"}
              </button>
              <button type="button" onClick={() => setIsLoginOpen(false)} className="w-full text-[9px] font-black text-gray-400 uppercase tracking-widest mt-6">
                Terminate Access
              </button>
            </form>
          </div>
        </div>
      )}

      <footer className="fixed bottom-6 left-0 w-full px-6 md:px-12 flex justify-between items-center pointer-events-none opacity-20 md:opacity-30">
        <p className="text-[7px] md:text-[8px] font-black text-blue-950 uppercase tracking-[0.3em]">Sys.04 // {slug}</p>
        <p className="text-[7px] md:text-[8px] font-black text-blue-950 uppercase tracking-[0.3em]">ZingConnect</p>
      </footer>
    </div>
  );
};