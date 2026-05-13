import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsChevronLeft, 
  BsShieldCheck, 
  BsSoundwave, 
  BsStars, 
  BsShieldLockFill,
  BsCheckCircleFill, 
  BsPlayFill, 
  BsPauseFill, 
  BsX,
  BsClockHistory,
  BsTelephoneInboundFill,
  BsTelephoneOutboundFill,
} from 'react-icons/bs';

export const CallSetting = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [agentData, setAgentData] = useState(null);
  const [callLogs, setCallLogs] = useState([]);
  const [devices, setDevices] = useState({ inputs: [], outputs: [] });

  const [voiceEffect, setVoiceEffect] = useState(null); 
  const [pendingVoice, setPendingVoice] = useState(null);
  const [unlockedVoices, setUnlockedVoices] = useState([]); 
  const [isSyncing, setIsSyncing] = useState(false);

  const [selectedVoiceForPurchase, setSelectedVoiceForPurchase] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null); 
  const [isSuccess, setIsSuccess] = useState(false); 
  const [currentlyPlaying, setCurrentlyPlaying] = useState(null);

  const audioRef = useRef(new Audio());

  const eliteVoices = [
    { id: null, name: 'Natural Voice', icon: '👤', description: 'No Masking (Default)', previewUrl: null },
    { id: 'nPczCjzB2QC9zZ6ULpFM', name: 'Natural Professional', icon: '🎙️', description: 'Standard Secure Line', previewUrl: 'https://files.elevenlabs.io/sample_1.mp3' },
    { id: 'auq43ws1oslv0tO4BDa7', name: 'Adam Stone', icon: '🚀', description: 'American / Energetic', previewUrl: '/audio/voices/AdamStone.mp3' },
    { id: 'EST9Ui6982FZPSi7gCHi', name: 'Elise VP', icon: '🏛️', description: 'Formal American', previewUrl: '/audio/voices/EliseVP.mp3' },
    { id: 'DLsHlh26Ugcm6ELvS0qi', name: 'Ms Walker', icon: '🇬🇧', description: 'UK / Trustworthy', previewUrl: '/audio/voices/MsWalker.mp3' }
  ];

    useEffect(() => {
    const applyTheme = () => {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    applyTheme();
    window.addEventListener('storage', applyTheme);
    return () => window.removeEventListener('storage', applyTheme);
  }, []);

  // 1. DATA INITIALIZATION
  useEffect(() => {
    const initSettings = async () => {
      const token = localStorage.getItem('agentToken');
      if (!token) return navigate('/'); 

      try {
        const baseUrl = window.location.origin;
        const profileRes = await fetch(`${baseUrl}/api/agents/profile/me`, { 
          headers: { 'Authorization': `Bearer ${token}` } 
        });
        
        if (!profileRes.ok) throw new Error("Failed to load profile");
        const result = await profileRes.json();
        
        if (result.success && result.agent) {
          setAgentData(result.agent);
          setVoiceEffect(result.agent.voiceId ?? null); 
          setUnlockedVoices(result.agent.unlockedVoiceIds || []);
        }

        const logRes = await fetch(`${baseUrl}/api/calls/history/me`, { 
          headers: { 'Authorization': `Bearer ${token}` } 
        });
        const logData = await logRes.json();
        if (logData.success) setCallLogs(logData.calls);

        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        setDevices({
          inputs: mediaDevices.filter(d => d.kind === 'audioinput'),
          outputs: mediaDevices.filter(d => d.kind === 'audiooutput')
        });
      } catch (err) {
        console.error("Init Error:", err);
        if (err.message === "Failed to load profile") {
          localStorage.removeItem('agentToken');
          navigate('/');
        }
      } finally {
        setLoading(false);
      }
    };
    initSettings();
  }, [navigate]);

  // 3. HANDLERS
  const handlePlayPreview = async (e, voice) => {
    e.stopPropagation(); 
    if (currentlyPlaying === voice.id) {
      audioRef.current.pause();
      setCurrentlyPlaying(null);
    } else if (voice.previewUrl) {
      try {
        audioRef.current.pause();
        audioRef.current.src = voice.previewUrl;
        audioRef.current.load(); 
        await audioRef.current.play();
        setCurrentlyPlaying(voice.id);
        audioRef.current.onended = () => setCurrentlyPlaying(null);
      } catch (err) {
        console.error("Preview playback error:", err);
        setCurrentlyPlaying(null);
      }
    }
  };

  const handleVoiceClick = (voice) => {
    const isNaturalVoice = voice.id === null;
    const isUnlocked = isNaturalVoice || unlockedVoices.includes(voice.id);

    if (isUnlocked) {
      setPendingVoice(prev => (prev === voice.id ? null : voice.id));
      setSelectedVoiceForPurchase(null);
    } else {
      setSelectedVoiceForPurchase(voice);
      setSelectedPlan(null);
    }
  };

  const processVoicePayment = () => {
    if (!agentData?.email || !selectedPlan || !selectedVoiceForPurchase) {
      alert("Please wait for account details to load completely.");
      return;
    }
    const publicKey = import.meta.env.VITE_FLW_PUBLIC_KEY?.trim();
    if (!publicKey) {
      alert("Payment configuration error.");
      return;
    }
    if (typeof window.FlutterwaveCheckout !== 'function') {
      alert("Payment gateway is still loading.");
      return;
    }

    const numericAmount = Number(selectedPlan.price.replace(/,/g, '').trim());
    const txRef = `VS_${agentData._id?.slice(-8) || 'AGENT'}_${Date.now()}`;

    window.FlutterwaveCheckout({
      public_key: publicKey,
      tx_ref: txRef,
      amount: numericAmount,
      currency: "NGN",
      payment_options: "card,banktransfer,ussd,flutterwave",
      customer: {
        email: String(agentData.email).toLowerCase().trim(),
        name: `${agentData.firstName || ''} ${agentData.lastName || ''}`.trim() || "Zing Agent",
        phone_number: agentData.phone || "",
      },
      customizations: {
        title: "ZingConnect Voice Identity",
        description: `Unlocking ${selectedVoiceForPurchase.name}`,
        logo: "https://cdn-icons-png.flaticon.com/512/9431/9431166.png",
      },
      callback: async (response) => {
        if (response.status === "successful" || response.status === "completed") {
          try {
            const token = localStorage.getItem('agentToken');
            const verifyRes = await fetch('/api/agents/unlock-voice-package', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
              },
              body: JSON.stringify({ 
                transactionId: response.transaction_id || response.id, 
                voiceId: selectedVoiceForPurchase.id,
                duration: selectedPlan.term,
                amount: numericAmount
              })
            });
            if (verifyRes.ok) {
              setUnlockedVoices(prev => [...prev, selectedVoiceForPurchase.id]);
              setPendingVoice(selectedVoiceForPurchase.id);
              setIsSuccess(true);
              setSelectedVoiceForPurchase(null);
              setSelectedPlan(null);
              setTimeout(() => setIsSuccess(false), 3000);
            }
          } catch (error) {
            console.error("Verification Error:", error);
          }
        }
      }
    });
  };

  const handleApplyVoice = async () => {
    if (pendingVoice === null || pendingVoice === voiceEffect || isSyncing) return;
    const selectedVoiceObj = eliteVoices.find(v => v.id === pendingVoice);
    const displayName = selectedVoiceObj ? selectedVoiceObj.name : 'Natural Voice';
    setIsSyncing(true);
    try {
      const token = localStorage.getItem('agentToken');
      const res = await fetch(`${window.location.origin}/api/agents/update-profile`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ voiceId: pendingVoice, voiceDisplayName: displayName })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setVoiceEffect(result.agent.voiceId ?? null);
        setPendingVoice(null);
      }
    } catch (error) {
      console.error("Voice Sync Error:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center bg-page-bg transition-colors duration-300">
      <div className="w-8 h-8 border-2 border-zing-blue border-t-transparent rounded-full animate-spin mb-4" />
      <div className="text-[10px] font-black uppercase tracking-widest text-text-secondary animate-pulse">
        Initializing Communication Core...
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-page-bg text-text-main font-sans antialiased transition-colors duration-300 pb-20">
      
      {/* 4. UPDATED HEADER */}
      <header className="sticky top-0 z-40 bg-card-bg/80 backdrop-blur-md border-b border-gray-100 dark:border-slate-800 px-4 py-4 md:px-12 flex justify-between items-center transition-colors">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-[10px] font-black uppercase text-text-secondary hover:text-zing-blue transition-colors">
          <BsChevronLeft size={14} /> <span>Back</span>
        </button>
        <div className="flex items-center gap-2">
          <BsShieldCheck className="text-zing-blue" size={16} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-text-main">Communication Core</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 px-4 space-y-8">
        
        {/* 5. VOICE SECTION (Keeps brand blue but uses Tailwind v4 colors inside) */}
        <section className="bg-blue-900 text-white p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
          <BsSoundwave className="absolute -right-4 -bottom-4 text-white/5" size={150} />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <BsStars className="text-blue-300" />
                <h2 className="text-lg font-black uppercase tracking-widest">Identity Masking</h2>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {eliteVoices.map((voice) => {
                const isSelected = pendingVoice === voice.id;
                const isApplied = voiceEffect === voice.id && pendingVoice === null;
                const isLocked = voice.id !== null && !unlockedVoices.includes(voice.id);

                return (
                  <button
                    key={voice.id ?? 'natural-voice'}
                    onClick={() => handleVoiceClick(voice)}
                    className={`relative flex flex-col items-center p-5 rounded-3xl border transition-all duration-300 ${
                      isSelected 
                        ? 'bg-white text-blue-900 border-white shadow-lg scale-105' 
                        : 'bg-white/10 border-white/20 hover:bg-white/20'
                    }`}
                  >
                    {voice.previewUrl && (
                      <div onClick={(e) => handlePlayPreview(e, voice)} className={`absolute top-2 left-2 p-1.5 rounded-full z-10 ${isSelected ? 'bg-blue-50 text-blue-600 shadow-sm' : 'bg-white/10'}`}>
                        {currentlyPlaying === voice.id ? <BsPauseFill size={14}/> : <BsPlayFill size={14}/>}
                      </div>
                    )}
                    {isLocked && <BsShieldLockFill className="absolute top-3 right-3 text-white/40" size={12} />}
                    <span className="text-2xl mb-2">{voice.icon}</span>
                    <span className="text-[10px] font-black uppercase text-center leading-tight">{voice.name}</span>
                    {isApplied ? (
                      <div className="flex items-center gap-1 mt-3 text-green-400">
                        <BsCheckCircleFill size={12} />
                        <span className="text-[7px] font-black uppercase">Active</span>
                      </div>
                    ) : (
                      <span className={`text-[7px] font-bold mt-3 uppercase opacity-60 ${isSelected ? 'text-blue-900' : 'text-white'}`}>
                        {isLocked ? "Unlock Identity" : voice.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {pendingVoice !== null && pendingVoice !== voiceEffect && (
              <div className="mt-8 flex items-center justify-center">
                <button onClick={handleApplyVoice} disabled={isSyncing} className="bg-zing-blue hover:opacity-90 disabled:opacity-70 text-white px-10 py-4 rounded-2xl flex items-center gap-3 shadow-2xl transition-all">
                  <BsShieldLockFill className={isSyncing ? "animate-spin" : ""} />
                  <span className="text-[11px] font-black uppercase tracking-widest">
                    {isSyncing ? "Syncing Identity..." : "Apply Voice Identity"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* 6. UPDATED DEVICE SELECTION */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card-bg border border-gray-100 dark:border-slate-800 p-6 rounded-[2rem] shadow-sm transition-colors">
            <h3 className="text-[9px] font-black uppercase tracking-widest mb-4 text-text-secondary">Input Device</h3>
            <select className="w-full bg-input-bg text-text-main border-none rounded-xl px-4 py-3 text-xs outline-none focus:ring-1 focus:ring-zing-blue transition-colors">
              {devices.inputs.map(d => (
                <option key={d.deviceId} className="bg-card-bg">{d.label || 'Default Mic'}</option>
              ))}
            </select>
          </div>
          <div className="bg-card-bg border border-gray-100 dark:border-slate-800 p-6 rounded-[2rem] shadow-sm transition-colors">
            <h3 className="text-[9px] font-black uppercase tracking-widest mb-4 text-text-secondary">Output Device</h3>
            <select className="w-full bg-input-bg text-text-main border-none rounded-xl px-4 py-3 text-xs outline-none focus:ring-1 focus:ring-zing-blue transition-colors">
              {devices.outputs.map(d => (
                <option key={d.deviceId} className="bg-card-bg">{d.label || 'Default Speaker'}</option>
              ))}
            </select>
          </div>
        </section>

        {/* 7. UPDATED CALL LOGS SECTION */}
        <section className="mt-12 space-y-6">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <BsClockHistory className="text-zing-blue" />
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-main">Communication Logs</h2>
            </div>
            <span className="text-[9px] font-black text-text-secondary uppercase">{callLogs.length} Total Sessions</span>
          </div>

          <div className="space-y-3">
            {callLogs.length > 0 ? (
              callLogs.map((log) => (
                <div key={log._id} className="bg-card-bg border border-gray-100 dark:border-slate-800 p-5 rounded-[2rem] shadow-sm flex items-center justify-between hover:border-zing-blue/30 transition-all">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${log.type === 'incoming' ? 'bg-green-500/10 text-green-500' : 'bg-zing-blue/10 text-zing-blue'}`}>
                      {log.type === 'incoming' ? <BsTelephoneInboundFill size={16} /> : <BsTelephoneOutboundFill size={16} />}
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase text-text-main">
                        {log.participantName || "Secure Session"}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[8px] font-bold text-text-secondary uppercase">{new Date(log.createdAt).toLocaleDateString()}</span>
                        <span className="w-1 h-1 bg-text-secondary/20 rounded-full"></span>
                        <span className="text-[8px] font-bold text-text-secondary uppercase">{new Date(log.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2 justify-end text-zing-blue">
                      <BsSoundwave size={12} className="opacity-50" />
                      <span className="text-xs font-black font-mono">{log.duration || "00:00"}</span>
                    </div>
                    <p className="text-[7px] font-black uppercase text-text-secondary mt-1 tracking-widest">Session End</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 bg-card-bg rounded-[2.5rem] border border-dashed border-gray-200 dark:border-slate-800">
                <p className="text-[10px] font-black uppercase text-text-secondary tracking-widest">No communication logs found</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* 8. UPDATED PURCHASE MODAL */}
      {selectedVoiceForPurchase && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setSelectedVoiceForPurchase(null)} />
          <div className="relative bg-card-bg text-text-main w-full max-w-md rounded-[3rem] p-10 shadow-2xl border border-gray-100 dark:border-slate-800">
            <button onClick={() => setSelectedVoiceForPurchase(null)} className="absolute top-8 right-8 text-text-secondary hover:text-zing-blue">
              <BsX size={28} />
            </button>
            <div className="text-center mb-10">
              <div className="w-20 h-20 bg-page-bg rounded-full flex items-center justify-center mx-auto mb-4 text-4xl">{selectedVoiceForPurchase.icon}</div>
              <h2 className="text-2xl font-black uppercase tracking-tight">Unlock {selectedVoiceForPurchase.name}</h2>
              <p className="text-[10px] text-text-secondary font-black uppercase mt-2 tracking-widest">AI Voice Identity Masking</p>
            </div>
            <div className="space-y-4">
              {[
                { term: '1 Month Identity', price: '10,500', tier: 'VOICE_30' },
                { term: '6 Months Identity', price: '55,500', tier: 'VOICE_180' },
                { term: '1 Year Identity', price: '120,000', tier: 'VOICE_365' }
              ].map((plan) => (
                <button key={plan.tier} onClick={() => setSelectedPlan(plan)} 
                  className={`w-full flex items-center justify-between p-6 rounded-[1.8rem] border transition-all ${
                    selectedPlan?.tier === plan.tier 
                    ? 'bg-zing-blue border-zing-blue text-white shadow-lg' 
                    : 'bg-input-bg border-transparent hover:bg-page-bg text-text-main'
                  }`}>
                  <div className="text-left">
                    <p className="text-[11px] font-black uppercase">{plan.term}</p>
                    <p className="text-[7px] font-bold uppercase opacity-60">Instant AI Activation</p>
                  </div>
                  <p className="text-lg font-black">₦{plan.price}</p>
                </button>
              ))}
            </div>
            {selectedPlan && (
              <button onClick={processVoicePayment} className="w-full mt-8 bg-green-500 hover:opacity-90 text-white py-5 rounded-[1.5rem] shadow-xl flex items-center justify-center gap-3">
                <BsShieldLockFill size={18} />
                <span className="text-[12px] font-black uppercase tracking-widest">Secure Checkout</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 9. SUCCESS MODAL */}
      {isSuccess && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-page-bg/95 backdrop-blur-md transition-colors">
          <div className="max-w-sm text-center">
            <div className="w-24 h-24 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-8 animate-bounce">
              <BsCheckCircleFill size={48} />
            </div>
            <h2 className="text-4xl font-black text-text-main uppercase tracking-tighter leading-none mb-4">Success!</h2>
            <p className="text-text-secondary font-bold uppercase text-[10px] tracking-widest">Voice Identity Activated.</p>
            <button onClick={() => setIsSuccess(false)} className="mt-10 w-full bg-zing-blue text-white py-5 rounded-[1.5rem] font-black uppercase text-[11px] tracking-[0.2em] shadow-2xl">
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
};