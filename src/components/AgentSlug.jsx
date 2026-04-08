import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BsShieldLockFill, BsLightningFill, BsEyeFill, BsEyeSlashFill, BsPersonFill } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const AgentSlug = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // --- REAL APPLICATION STATE ---
  const [agentData, setAgentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // --- LOGIN FORM STATE ---
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // --- FETCH PUBLIC PROFILE ---
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

  // --- HANDLE REAL LOGIN ---
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
        // Save the JWT Token to LocalStorage
        localStorage.setItem('zingToken', data.token);
        localStorage.setItem('agentSlug', data.slug);
        
        // Navigate to a secure dashboard or refresh state
        alert("Verification Successful. Entering Portal...");
        setIsLoginOpen(false);
        // navigate('/dashboard'); // If you have a dashboard route
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
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error || !agentData) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-6 text-center">
      <h1 className="text-2xl font-black mb-4">404 - Profile Not Found</h1>
      <button onClick={() => navigate('/')} className="text-xs font-black uppercase tracking-widest text-blue-600">Return Home</button>
    </div>
  );

  const fullName = `${agentData.firstName} ${agentData.lastName}`;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-blue-950 font-sans overflow-x-hidden">
      
      {/* Header */}
      <header className="py-6 px-8 flex justify-between items-center bg-white/50 backdrop-blur-sm fixed top-0 w-full z-40">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-7 w-auto cursor-pointer" onClick={() => navigate('/')} />
        <button 
          onClick={() => setIsLoginOpen(true)}
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-colors"
        >
          Portal Access <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center border border-gray-100"><BsShieldLockFill size={12} /></div>
        </button>
      </header>

      {/* Main Content Area */}
      <main className={`transition-all duration-700 pt-32 pb-20 px-6 max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12 ${isLoginOpen ? 'blur-xl scale-95 pointer-events-none' : ''}`}>
        
        {/* Left Side: Profile Details */}
        <div className="flex-1 space-y-8 animate-in fade-in slide-in-from-left-10 duration-1000">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest">Direct Communication Active</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-tight">
            Connect with <br />
            <span className="text-blue-600">{fullName}</span>
          </h1>

          <div className="flex gap-1">
            {[1, 2, 3].map(i => <div key={i} className="w-1.5 h-1.5 bg-blue-600 rounded-full" />)}
          </div>

          <div className="space-y-6 max-w-lg">
            <div className="w-32 h-32 rounded-[2.5rem] bg-gray-100 border-4 border-white shadow-2xl overflow-hidden flex items-center justify-center text-gray-300">
              {agentData.photoUrl ? (
                <img src={agentData.photoUrl} alt={fullName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-4xl font-black tracking-tighter text-gray-200">
                  {agentData.firstName[0]}{agentData.lastName[0]}
                </span>
              )}
            </div>
            
            <div className="space-y-2">
              <p className="text-xs font-black text-blue-600 uppercase tracking-widest">{agentData.program || agentData.occupation}</p>
              <p className="text-sm font-medium text-gray-500 leading-relaxed italic">
                "{agentData.bio || "Secure professional channel established."}"
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4">
             <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full border-2 border-white bg-gray-200" />
                <div className="w-8 h-8 rounded-full border-2 border-white bg-gray-300" />
                <div className="w-8 h-8 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-[8px] font-bold">+12k</div>
             </div>
             <div className="h-8 w-[1px] bg-gray-200 mx-2" />
             <div>
                <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Security Protocol</p>
                <p className="text-[10px] font-bold">Encrypted</p>
             </div>
          </div>
        </div>

        {/* Right Side: Initial Inquiry Form */}
        <div className="w-full max-w-md animate-in fade-in slide-in-from-right-10 duration-1000 delay-200">
          <div className="bg-white p-10 rounded-[3rem] shadow-2xl shadow-blue-100 border border-gray-50 text-center">
            <h2 className="text-xl font-black mb-1">Start Communication</h2>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-8">Professional inquiry portal.</p>
            
            <div className="text-left space-y-4">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Email Address</label>
                <input 
                  type="email" 
                  placeholder="name@email.com"
                  className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm outline-none focus:border-blue-600 transition-all"
                />
              </div>
              <button className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-100">
                Initialize Secure Chat <BsLightningFill />
              </button>
            </div>

            <div className="mt-8 flex justify-between items-center opacity-40">
              <span className="text-[8px] font-black uppercase">🔒 Encrypted</span>
              <span className="text-[10px] font-black border-2 border-blue-950 px-1 rounded">18+</span>
            </div>
          </div>
        </div>
      </main>

      {/* --- AUTHORIZED ACCESS MODAL (Login Section) --- */}
      {isLoginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-white/10 backdrop-blur-md animate-in fade-in duration-500">
          <div className="w-full max-w-md bg-white p-10 rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] border border-gray-100 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center mb-8">
              <div className="w-12 h-12 bg-blue-950 text-white rounded-2xl flex items-center justify-center mb-4">
                <BsShieldLockFill size={20} />
              </div>
              <h2 className="text-xl font-black">Authorized Access</h2>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-1">
                <input 
                  required
                  type="email" 
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Agent Email"
                  className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm outline-none focus:border-blue-600 transition-all"
                />
              </div>
              <div className="relative">
                <input 
                  required
                  type={showPassword ? "text" : "password"} 
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm outline-none focus:border-blue-600 transition-all"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPassword ? <BsEyeSlashFill /> : <BsEyeFill />}
                </button>
              </div>
              
              <button 
                disabled={isLoggingIn}
                className="w-full py-5 bg-[#0F172A] text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50"
              >
                {isLoggingIn ? "Verifying..." : "Verify & Login"}
              </button>

              <div className="flex flex-col items-center gap-4 mt-6">
                <button type="button" className="text-[9px] font-black text-blue-600 uppercase tracking-widest hover:underline">
                  Forgot Password?
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsLoginOpen(false)}
                  className="text-[9px] font-black text-gray-400 uppercase tracking-widest hover:text-red-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer Decoration */}
      <div className="fixed bottom-6 left-8">
        <p className="text-[8px] font-black text-gray-300 uppercase tracking-[0.3em]">Speed. Security. Success.</p>
      </div>
    </div>
  );
};