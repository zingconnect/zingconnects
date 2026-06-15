import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  BsShieldLockFill, 
  BsLightningFill, 
  BsEyeFill, 
  BsEyeSlashFill, 
  BsCheckCircleFill, 
  BsDownload
} from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';
import { useAuth } from '../context/AuthContext'; // Import your hook
import { secureFetch } from "../../api/utils/api"; // Ensure this import path is correct
import { SignalEngine } from '../utils/SignalEngine';


export const AgentSlug = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
const { setToken, login } = useAuth();   
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agentData, setAgentData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [rememberUser, setRememberUser] = useState(false);
  const [rememberAgent, setRememberAgent] = useState(false);
const fullName = agentData ? `${agentData.firstName || ''} ${agentData.lastName || ''}`.trim() : '';
const isMounted = React.useRef(true);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const isAppleDevice = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isAppleDevice && !isStandalone) {
      setIsIOS(true);
      const hasSeenModal = sessionStorage.getItem('iosModalSeen');
      if (!hasSeenModal) {
        const timer = setTimeout(() => {
          setShowIOSModal(true);
          sessionStorage.setItem('iosModalSeen', 'true');
        }, 5000); 
        return () => clearTimeout(timer);
      }
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    localStorage.setItem('agentSlug', slug);
    const params = new URLSearchParams(window.location.search);
    if (!params.get('pwa')) {
      const newUrl = `${window.location.origin}/${slug}?pwa=${slug}`;
      window.history.replaceState({ path: newUrl }, '', newUrl);
    }
  }, [slug]);

useEffect(() => {
    const fetchAgentProfile = async () => {
      try {
        setLoading(true);
        setError(false);
        const response = await fetch(`/api/agents/${slug}`);
        if (!response.ok) throw new Error("Agent not found");
        
        const result = await response.json();
        // Correctly accessing the nested 'agent' object from your API response
        if (result.success && result.agent) {
          setAgentData(result.agent);
        } else {
          throw new Error("Invalid data format");
        }
      } catch (err) {
        console.error("Fetch error:", err);
        setError(true);
            } finally {
        setLoading(false);
      }
    };

    if (slug) fetchAgentProfile();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const savedUserEmail = localStorage.getItem(`rememberedUserEmail_${slug}`);
    const savedAgentEmail = localStorage.getItem(`rememberedAgentEmail_${slug}`);
    if (savedUserEmail) { setUserEmail(savedUserEmail); setRememberUser(true); }
    if (savedAgentEmail) { setLoginEmail(savedAgentEmail); setRememberAgent(true); }
  }, [slug]);

  useEffect(() => {
  window.addEventListener('appinstalled', (evt) => {
    console.log('ZingConnect installed successfully!');
    setShowInstallBtn(false);
  });
}, []);

 const handleInstallApp = async () => {
  if (!deferredPrompt) {
    console.log("Install prompt not available.");
    return;
  }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
  
  console.log(`User choice: ${outcome}`);
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
    setShowInstallBtn(false);
  }
};

React.useEffect(() => {
  return () => { isMounted.current = false; };
}, []);

const handleUserInquiry = async (e) => {
  e.preventDefault();
  if (!userEmail) return alert("Please enter your email.");
  if (!slug) return alert("Agent context missing.");

  setIsProcessing(true);

  try {
    // 1. Setup User Identity
    const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity();
    await SignalEngine.store.saveIdentity('local', identityKeyPair);

    // 2. Generate a local deviceId (e.g., random integer or based on browser storage)
    // Ensure your SignalEngine.store supports retrieving/generating this
    const deviceId = await SignalEngine.store.getOrGenerateDeviceId();

    // 3. Initiate secure handshake
    const response = await secureFetch('/api/users/handshake', {
      method: 'POST',
      body: JSON.stringify({
        email: userEmail.trim(),
        agentSlug: slug,
        userPublicKeyJwk: preKeyBundle,
        deviceId // CRITICAL: Pass the device ID to the handshake
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Handshake failed");

    if (data.agentIdentity) {
      await SignalEngine.store.savePeerBundle(slug, data.agentIdentity);
      try {
        await SignalEngine.initializeSession(slug, data.agentIdentity);
      } catch (err) {
        console.warn("Session initialization failed:", err);
      }
    }
    
    if (typeof login === 'function') await login(slug);
    navigate(`/user/dashboard/${slug}`, { replace: true });

  } catch (err) {
    console.error("Handshake error:", err);
    alert("System error. Please try again.");
  } finally {
    setIsProcessing(false);
  }
};

const handleAgentLogin = async (e) => {
  e.preventDefault();
  setIsProcessing(true);

  const payload = {
    email: loginEmail.toLowerCase().trim(),
    password: loginPassword,
    targetSlug: slug.toLowerCase().trim(),
    force: true
  };

  try {
    const response = await secureFetch('/api/agents/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    
    const data = await response.json();

    if (!isMounted.current) return;

    if (response.ok) {
      // 1. Await the login state update. 
      // Ensure your AuthProvider login function calls verifySession() internally.
      if (typeof login === 'function') {
        await login(payload.targetSlug); 
      }
      
      if (rememberAgent) {
        localStorage.setItem(`rememberedAgentEmail_${payload.targetSlug}`, loginEmail.trim());
      }
      
      // 2. Navigation will now be guarded by the updated isAuthenticated state
      // resulting from the successful login/verifySession call.
      navigate(`/agent/dashboard/${payload.targetSlug}`);
    } else {
      console.error("Login Server Error:", data.message);
      alert(data.message || "Invalid Credentials");
    }
  } catch (err) {
    console.error("Network Error:", err);
    if (isMounted.current) alert("Connection error. Please try again.");
  } finally {
    if (isMounted.current) setIsProcessing(false);
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

  const displayName = `${agentData.firstName || ''} ${agentData.lastName || ''}`.trim();

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 font-sans">
      {/* Header and UI components remain as before, utilizing the safe {displayName} variable */}
      <header className="py-3 px-4 md:py-4 md:px-12 flex justify-between items-center bg-white/70 backdrop-blur-xl fixed top-0 w-full z-40 border-b border-gray-100/50">
        <div className="flex items-center cursor-pointer group" onClick={() => navigate('/')}>
          <img src={ZingConnectLogo} alt="ZingConnect" className="h-8 md:h-12 w-auto" />
        </div>
        <button onClick={() => setIsLoginOpen(true)} className="flex items-center gap-2 text-[8px] font-bold uppercase tracking-[0.2em] text-gray-500 hover:text-blue-600">
          Portal Access <BsShieldLockFill />
        </button>
      </header>

      <main className={`transition-all duration-1000 pt-24 md:pt-40 pb-10 px-4 md:px-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 md:gap-16 items-start md:items-center ${isLoginOpen ? 'blur-2xl scale-[0.98] pointer-events-none' : ''}`}>
        
        <div className="w-full max-w-lg mx-auto lg:ml-auto order-first lg:order-last">
          <div className="bg-white p-6 md:p-12 rounded-[2.5rem] md:rounded-[4rem] shadow-xl border border-gray-100 relative overflow-hidden">
            <form onSubmit={handleUserInquiry} className="relative z-10">
              <div className="text-center mb-6 md:mb-10">
                <h2 className="text-xl md:text-2xl font-black tracking-tight mb-1 text-blue-950">Secure Inquiry</h2>
                <p className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em]">Private Communication Line</p>
              </div>
              
              <div className="space-y-4 md:space-y-5">
                <div>
                  <label className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest ml-4 mb-2 block">Your Identity (Email)</label>
                  <input 
                    required type="email" value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="Enter email to verify..."
                    className="w-full px-6 py-4 md:px-8 md:py-5 bg-gray-50/50 border border-gray-100 rounded-[1.5rem] md:rounded-[2rem] text-xs md:text-sm outline-none focus:bg-white focus:border-blue-600 transition-all"
                  />
                  <div className="flex items-center gap-2 ml-4 mt-3">
                    <input 
                      type="checkbox" id="rememberUser" checked={rememberUser}
                      onChange={(e) => setRememberUser(e.target.checked)}
                      className="w-3 h-3 rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                    <label htmlFor="rememberUser" className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest cursor-pointer">Remember Identity</label>
                  </div>
                </div>
                
                <button 
                  type="submit" disabled={isProcessing}
                  className="w-full py-5 md:py-6 bg-blue-600 text-white rounded-[1.5rem] md:rounded-[2rem] font-black text-[10px] md:text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isProcessing ? "Connecting..." : "Start Live Session"} <BsLightningFill />
                </button>
                
                <div className="flex flex-col items-center gap-2">
                  {showInstallBtn && (
                    <button 
                      type="button"
                      onClick={handleInstallApp}
                      className="flex items-center gap-2 text-[8px] md:text-[9px] font-black text-blue-600 uppercase tracking-widest hover:opacity-70 transition-opacity"
                    >
                      <BsDownload size={10} /> Add ZingConnect to Home Screen
                    </button>
                  )}
                  <p className="text-[8px] text-center text-gray-400 font-medium px-4 leading-relaxed">
                    By initializing, you agree to the <span className="text-blue-600 underline cursor-pointer">Security Terms</span>.
                  </p>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div className="space-y-8 md:space-y-10">
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

          <div className="flex flex-col sm:flex-row items-center gap-6 md:gap-8">
            <div className="relative">
              <div className="w-24 h-24 md:w-44 md:h-44 rounded-[2rem] md:rounded-[3rem] bg-white border-[4px] md:border-[6px] border-white shadow-lg overflow-hidden flex items-center justify-center">
                {agentData.photoUrl ? (
                  <img src={agentData.photoUrl} alt={fullName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl md:text-4xl font-black text-blue-100 uppercase">
                    {agentData?.firstName?.[0]}{agentData?.lastName?.[0]}
                  </span>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white p-1.5 rounded-full border-2 border-[#FDFDFD]">
                <BsCheckCircleFill className="size-3 md:size-4" />
              </div>
            </div>
            
            <div className="space-y-2 md:space-y-3 max-w-sm text-center sm:text-left">
              {agentData.program && (
                <div className="mb-1">
                  <span className="text-[9px] md:text-[15px] font-black text-purple-950 uppercase tracking-[0.15em]">
                    {agentData.program}
                  </span>
                </div>
              )}
              <h3 className="text-[9px] md:text-[11px] font-black text-blue-600 uppercase tracking-[0.2em]">
                {agentData.occupation || "Certified Professional"}
              </h3>
              <p className="text-sm md:text-lg font-medium text-slate-500 italic">
                "{agentData.bio || "Available for secure professional consultation."}"
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-20 py-12 px-6 border-t border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
            <div className="space-y-4">
              <div className="flex items-center">
                <img src={ZingConnectLogo} alt="ZingConnect" className="h-7 md:h-9 w-auto opacity-90 transition-opacity hover:opacity-100" />
              </div>
              <p className="text-[8px] md:text-[10px] text-gray-400 font-medium leading-relaxed max-w-xs">
                Secure, bidirectional communication platform for verified agents and clients. Powered by end-to-end encryption protocols.
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Official Program</h4>
              <div className="inline-flex items-center px-2 py-1.5 bg-gray-50 border border-gray-100 rounded-lg">
                <span className="text-[7px] md:text-[9px] font-bold text-blue-950 uppercase tracking-wide">
                  {agentData?.program || "Standard Verification Service"}
                </span>
              </div>
            </div>

            <div className="space-y-3 md:text-right">
              <h4 className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Security & Privacy</h4>
              <div className="flex flex-col md:items-end gap-1.5">
                <button className="text-[8px] md:text-[10px] font-bold text-gray-500 hover:text-blue-600 transition-colors uppercase tracking-widest">Privacy Policy</button>
                <button className="text-[8px] md:text-[10px] font-bold text-gray-500 hover:text-blue-600 transition-colors uppercase tracking-widest">Terms of Service</button>
                <button className="text-[8px] md:text-[10px] font-bold text-gray-500 hover:text-blue-600 transition-colors uppercase tracking-widest">Compliance Audit</button>
              </div>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-gray-50 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-[7px] md:text-[9px] font-bold text-gray-400 uppercase tracking-widest text-center md:text-left">
              © 2026 ZingConnect Communications. All Rights Reserved.
            </p>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-[7px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest">System Status: Operational</span>
            </div>
          </div>
        </div>
      </footer>

    {isLoginOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md animate-in fade-in duration-300">
    <div className="w-full max-w-sm bg-white p-8 md:p-10 rounded-[2.5rem] shadow-[0_20px_40px_rgba(0,0,0,0.15)] border border-gray-100 relative overflow-hidden">
      
      {/* Decorative Top Accent */}
      <div className="absolute top-0 left-0 w-full h-1.5 bg-blue-950" />

      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-blue-50 text-blue-950 rounded-[1.5rem] flex items-center justify-center mb-6 mx-auto">
          <BsShieldLockFill size={28} />
        </div>
        <h2 className="text-2xl font-extrabold text-blue-950">ZingConnect Portal</h2>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-1">Secure Agent Authentication</p>
      </div>

      <form onSubmit={handleAgentLogin} className="space-y-4">
        {/* Email Input */}
        <div>
          <input 
            required type="email" value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            placeholder="AGENT SECURE ID"
            className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.25rem] text-xs font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-gray-400"
          />
        </div>

        {/* Password Input */}
        <div className="relative">
          <input 
            required type={showPassword ? "text" : "password"} value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            placeholder="ACCESS KEY"
            className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-[1.25rem] text-xs font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-gray-400"
          />
          <button 
            type="button" 
            onClick={() => setShowPassword(!showPassword)} 
            className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors"
          >
            {showPassword ? <BsEyeSlashFill size={16} /> : <BsEyeFill size={16} />}
          </button>
        </div>

        {/* Remember Me */}
        <div className="flex items-center gap-2 ml-1">
          <input 
            type="checkbox" id="rememberAgent" checked={rememberAgent}
            onChange={(e) => setRememberAgent(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-950 focus:ring-blue-500 cursor-pointer"
          />
          <label htmlFor="rememberAgent" className="text-[9px] font-black text-gray-400 uppercase tracking-widest cursor-pointer">
            Remember Access Key
          </label>
        </div>

        {/* Submit Button */}
        <button 
          disabled={isProcessing} 
          className="w-full py-5 bg-blue-950 text-white rounded-[1.25rem] font-black text-[10px] uppercase tracking-[0.25em] shadow-lg shadow-blue-950/20 active:scale-[0.98] transition-all disabled:opacity-60 mt-2"
        >
          {isProcessing ? "Verifying Identity..." : "Establish Connection"}
        </button>

        {/* Secondary Actions */}
        <div className="flex flex-col items-center pt-4 space-y-4">
          {(showInstallBtn || isIOS) && (
            <button 
              type="button" 
              onClick={isIOS ? () => setShowIOSModal(true) : handleInstallApp}
              className="flex items-center gap-2 text-[9px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors"
            >
              <BsDownload size={10} /> Install Portal App
            </button>
          )}
          <button 
            type="button" 
            onClick={() => setIsLoginOpen(false)} 
            className="text-[9px] font-black text-gray-400 uppercase tracking-widest hover:text-red-500 transition-colors"
          >
            Terminate Access
          </button>
        </div>
      </form>
    </div>
  </div>
)}
    </div>
  );
};