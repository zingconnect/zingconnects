import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  BsChevronLeft, 
  BsCameraFill, 
  BsCloudUpload, 
  BsShieldCheck,
  BsCalendarCheck,
  BsCashStack,
  BsHourglassSplit,
  BsKeyFill,
  BsMoonStarsFill,
  BsSunFill,
  BsDisplay,
  BsReceipt
} from 'react-icons/bs'; 
import { useAuth } from "../context/AuthContext";
import { secureFetch } from "../../api/utils/api";

export const AgentProfile = () => {
  const navigate = useNavigate();
  const { token, isLoading, setToken } = useAuth();
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(true);
  const [activeTheme, setActiveTheme] = useState(localStorage.getItem('theme') || 'system');
  
  // SUBSCRIPTION UPGRADE & TRANSACTION STATE CONFIGURATION
  const [subConfig, setSubConfig] = useState({ planTier: 'BASIC', months: 1 });
  const [isUpdatingSub, setIsUpdatingSub] = useState(false);
  const [transactions, setTransactions] = useState([]); 
  
  const [agentData, setAgentData] = useState({
    email: '',
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
    expiryDate: null,
    voiceId: 'nPczCjzB2QC9zZ6ULpFM',
    voiceDisplayName: 'Natural Professional'
  });

  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const planPricesInNGN = {
    'BASIC': 8500,          
    'GROWTH': 51000,         
    'PROFESSIONAL': 102000 
  };

  useEffect(() => {
    // Apply theme changes to document root instantly on initial mount
    handleThemeChange(activeTheme);

    const fetchProfileAndHistory = async () => {
      try {
        const storedToken = localStorage.getItem('accessToken');

        // 1. Fetch Agent Base Profile Details
        const profileResponse = await secureFetch('/api/agents/profile/me', storedToken, { 
          method: 'GET' 
        });

        if (!profileResponse.ok) throw new Error("Failed to load profile");
        const profileResult = await profileResponse.json();

        if (profileResult.success && profileResult.agent) {
          const agent = profileResult.agent;
          const isActive = agent.isSubscribed === true && agent.status === 'active';
          setIsSubscribed(isActive); 

          setAgentData(prevData => ({
            ...prevData,
            ...agent
          }));
        }

        // 2. Fetch Ledger History Collections Cleanly
        const historyResponse = await secureFetch('/api/agents/subscription/history', storedToken, {
          method: 'GET'
        });

        if (historyResponse.ok) {
          const historyResult = await historyResponse.json();
          setTransactions(historyResult.history || []);
        }

      } catch (err) {
        console.error("Profile/Ledger Initialisation Sync Error:", err);
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    fetchProfileAndHistory();
  }, [navigate]);

  const handleThemeChange = (newTheme) => {
    const root = window.document.documentElement;
    localStorage.setItem('theme', newTheme);
    setActiveTheme(newTheme);
    
    const isDark = newTheme === 'dark' || (newTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    
    if (passwordData.newPassword && passwordData.newPassword !== passwordData.confirmPassword) {
      return alert("New passwords do not match!");
    }

    setIsSaving(true);

    try {
      const storedToken = localStorage.getItem('accessToken');

      const response = await secureFetch('/api/agents/update-profile', storedToken, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({
          ...agentData,    
          ...passwordData
        })
      });

      if (response.ok) {
        alert("Identity & Security Sync Successful");
        setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
        localStorage.setItem('agentVoiceProfile', agentData.voiceId);
      } else {
        const errorData = await response.json();
        alert(errorData.message || "Error updating profile");
      }
    } catch (err) {
      console.error("Profile Update Error:", err);
      alert("Error updating profile. Please check your connection.");
    } finally {
      setIsSaving(false);
    }
  };

  // HANDLER: PROCESS PRODUCTION FLUTTERWAVE EXTENSION GATEWAY PIPELINE
  const handleUpgradeSubscription = async (e) => {
    e.preventDefault();

    if (!agentData || !agentData.email) {
      alert("Profile telemetry mapping incomplete. Please try again.");
      return;
    }

    setIsUpdatingSub(true);

    const targetMonthlyRate = planPricesInNGN[subConfig.planTier] || 8500;
    const finalCalculatedNairaAmount = targetMonthlyRate * subConfig.months;

    try {
      window.FlutterwaveCheckout({
        public_key: import.meta.env.VITE_FLW_PUBLIC_KEY,
        tx_ref: `ZING-EXT-${Date.now()}`,
        amount: finalCalculatedNairaAmount,
        currency: "NGN",
        payment_options: "card, account, transfer, ussd",
        customer: {
          email: agentData?.email,
          name: `${agentData?.firstName || ''} ${agentData?.lastName || ''}`.trim() || "Agent User",
        },
        customizations: {
          title: "ZingConnect",
          description: `Extend ${subConfig.planTier} Plan by ${subConfig.months} Month(s) (₦${finalCalculatedNairaAmount.toLocaleString()})`,
          logo: "https://cdn-icons-png.flaticon.com/512/9431/9431166.png",
        },
       callback: async (response) => {
  setIsUpdatingSub(true);

  try {
    const storedToken = localStorage.getItem('accessToken');

    const verifyRes = await secureFetch('/api/agents/update-subscription', storedToken, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planTier: subConfig.planTier,
        months: parseInt(subConfig.months, 10),
        transaction_id: response.transaction_id
      })
    });

    const result = await verifyRes.json();

    if (verifyRes.ok) {
      // 1. Update React State Optimistically
      setAgentData(prev => ({
        ...prev,
        plan: result.agent.plan,
        isSubscribed: result.agent.isSubscribed,
        expiryDate: result.agent.expiryDate,
        subscriptionAmount: result.agent.subscriptionAmount,
        paymentDetails: result.agent.paymentDetails
      }));
      setIsSubscribed(true);

      // 2. Refresh the page to ensure all components (Nav, Dashboard, Profile) 
      // fetch the fresh data from the server
      alert(result.message || "Subscription updated successfully!");
      window.location.reload(); 
    } else {
      alert(result.message || "Payment verification failed.");
    }
  } catch (err) {
    console.error("Critical Failure in Subscription Sync:", err);
    alert("Connection error occurred while syncing your payment.");
  } finally {
    setIsUpdatingSub(false);
  }
},
        onclose: () => {
          setIsUpdatingSub(false);
        }
      });
    } catch (err) {
      console.error("Flutterwave Runtime Framework Crash:", err);
      alert("Failed to initialize payment frame connection layer.");
      setIsUpdatingSub(false);
    }
  };

 // A unified helper that provides options
const formatData = (isoString, includeTime = true) => {
  if (!isoString) return 'N/A';
  
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime && { hour: '2-digit', minute: '2-digit', hour12: true })
  };
  
  return new Date(isoString).toLocaleString(undefined, options);
};

// Usage:
formatData(tx.paidAt); // Includes time (default)
formatData(tx.paidAt, false); // Date only

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-page-bg transition-colors duration-300">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-page-bg text-text-main pb-20 font-sans antialiased transition-colors duration-300">
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-100 dark:border-slate-800 px-4 py-4 md:px-12 flex justify-between items-center">
        <button 
          onClick={() => navigate(`/agent/dashboard/${agentData.slug || ''}`)} 
          className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 hover:text-blue-600 transition-all"
        >
          <BsChevronLeft size={14} /> <span className="hidden xs:inline">Back to Portal</span>
        </button>
        <div className="flex items-center gap-2">
          <BsShieldCheck className="text-blue-600" size={16} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-900 dark:text-blue-400">Secure Profile</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto mt-6 md:mt-16 px-4 space-y-10">
        
        {/* TOP STATUS WIDGET CARDS */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-blue-900 text-white p-5 rounded-[1.5rem] shadow-lg flex flex-col justify-between relative overflow-hidden min-h-[110px]">
            <BsCashStack className="absolute -right-2 -bottom-2 text-white/10" size={70} />
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest opacity-60 mb-1">Active Plan</p>
              <h2 className="text-xl font-black uppercase leading-none">{agentData.plan || 'BASIC'}</h2>
            </div>
            <p className="text-lg font-bold mt-2">
              ₦{Number(agentData.subscriptionAmount || agentData.paymentDetails?.amountNgn || planPricesInNGN[agentData.plan] || 0).toLocaleString()}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5 rounded-[1.5rem] shadow-sm flex flex-col justify-center min-h-[110px]">
            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Activation Date</p>
            <div className="flex items-center gap-2 text-blue-900 dark:text-blue-400">
              <BsCalendarCheck size={12} className="shrink-0" />
              <span className="text-xs font-bold break-words">
                {formatDate(agentData.subscriptionDate)}
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5 rounded-[1.5rem] shadow-sm flex flex-col justify-between min-h-[110px]">
            <div>
              <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-1">Expiry Date</p>
              <div className="flex items-center gap-2 text-red-500">
                <BsHourglassSplit size={12} className="shrink-0" />
                <span className="text-xs font-bold break-words">{formatDate(agentData.expiryDate)}</span>
              </div>
            </div>
            <span className={`mt-2 text-[7px] font-black uppercase tracking-widest ${isSubscribed ? 'text-green-500' : 'text-red-500'}`}>
              ● {isSubscribed ? 'Active' : 'Expired'}
            </span>
          </div>
        </section>

        {/* ✨ REAL TIME STACKABLE SUBSCRIPTION RENEWAL PANEL */}
        <section className="bg-card-bg/50 dark:bg-slate-900/50 p-6 rounded-[2rem] border border-dashed border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-5">
            <BsCashStack className="text-blue-600" size={16} />
            <h3 className="text-[9px] font-black uppercase tracking-[0.15em] text-blue-900 dark:text-blue-400">Stack / Extend Subscription Tenure</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-2">Select Subscription Tier</label>
              <select 
                value={subConfig.planTier}
                onChange={(e) => setSubConfig({ ...subConfig, planTier: e.target.value })}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-4 py-3.5 text-sm text-text-main outline-none focus:border-blue-600 transition-colors"
              >
                <option value="BASIC">BASIC — ₦8,500/mo</option>
                <option value="GROWTH">GROWTH — ₦51,000/mo</option>
                <option value="PROFESSIONAL">PROFESSIONAL — ₦102,000/mo</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-2">Extension Multiplier (Tenure Months)</label>
              <select 
                value={subConfig.months}
                onChange={(e) => setSubConfig({ ...subConfig, months: parseInt(e.target.value, 10) })}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-4 py-3.5 text-sm text-text-main outline-none focus:border-blue-600 transition-colors"
              >
                <option value="1">1 Month Extension</option>
                <option value="2">2 Months Extension</option>
                <option value="3">3 Months Extension</option>
                <option value="6">6 Months Extension</option>
                <option value="12">12 Months (Full Year Sync)</option>
              </select>
            </div>

            <div className="md:col-span-2 pt-2 flex flex-col sm:flex-row gap-4 items-center justify-between bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800">
              <div>
                <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Calculated Billing Ingestion</p>
                <p className="text-lg font-black text-blue-900 dark:text-blue-400 mt-0.5">
                  ₦{Number((planPricesInNGN[subConfig.planTier] || 8500) * subConfig.months).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                disabled={isUpdatingSub}
                onClick={handleUpgradeSubscription}
                className="w-full sm:w-auto px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-[9px] uppercase tracking-widest rounded-xl transition-all disabled:opacity-50 shadow-md"
              >
                {isUpdatingSub ? "Awaiting Gateway Payment..." : "Authorize Renewal Tenure"}
              </button>
            </div>
          </div>
        </section>

      <section className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-[2rem] p-6 shadow-sm">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
    <div>
      <h3 className="text-sm font-black tracking-tight text-blue-950 dark:text-white flex items-center gap-2">
        <BsReceipt className="text-blue-600" size={16} /> Billing Ingestion History
      </h3>
      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">Verified Ledger Audit Balance</p>
    </div>
    <span className="self-start sm:self-auto px-3 py-1 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-[9px] font-black uppercase rounded-lg">
      {transactions.length} Payment Nodes Found
    </span>
  </div>

  {transactions.length === 0 ? (
    <div className="text-center py-12 border border-dashed border-gray-100 dark:border-slate-800 rounded-2xl">
      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">No transactional ledger payloads logged yet.</p>
    </div>
  ) : (
    <>
      {/* Desktop Dashboard View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 dark:border-slate-800">
              <th className="pb-3 text-[9px] font-black uppercase tracking-wider text-gray-400">Reference ID</th>
              <th className="pb-3 text-[9px] font-black uppercase tracking-wider text-gray-400">Tier Stacked</th>
              <th className="pb-3 text-[9px] font-black uppercase tracking-wider text-gray-400">Tenure Block</th>
              <th className="pb-3 text-[9px] font-black uppercase tracking-wider text-gray-400">Ingested Date</th>
              <th className="pb-3 text-[9px] font-black uppercase tracking-wider text-gray-400 text-right">Amount Injected</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
            {transactions.map((tx, idx) => (
              <tr key={tx.transactionId || idx} className="text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                <td className="py-3.5 font-mono text-[10px] text-gray-500 dark:text-slate-400 font-bold">
                  #{String(tx.transactionId).slice(-8).toUpperCase()}
                </td>
                <td className="py-3.5">
                  <span className="px-2 py-0.5 bg-blue-900 text-white dark:bg-blue-600 font-black text-[8px] tracking-wide rounded uppercase">
                    {tx.plan}
                  </span>
                </td>
                <td className="py-3.5 text-gray-500 dark:text-slate-400 font-bold uppercase text-[10px]">
                  {tx.months} Mo{tx.months > 1 ? 's' : ''} Extension
                </td>
                <td className="py-3.5 text-gray-400 font-medium">
                  {formatDateTime(tx.paidAt)}
                </td>
                <td className="py-3.5 text-right font-black text-blue-950 dark:text-white">
                  ₦{Number(tx.amount).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Handheld Mobile Device View */}
      <div className="md:hidden space-y-3">
        {transactions.map((tx, idx) => (
          <div key={tx.transactionId || idx} className="bg-input-bg/60 border border-gray-100 dark:border-slate-800 p-4 rounded-xl space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] text-gray-400 font-bold">
                #{String(tx.transactionId).slice(-8).toUpperCase()}
              </span>
              <span className="px-2 py-0.5 bg-blue-900 text-white font-black text-[8px] tracking-wide rounded uppercase">
                {tx.plan}
              </span>
            </div>
            <div className="flex justify-between items-end pt-1">
              <div>
                <p className="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase">
                  {tx.months} Month{tx.months > 1 ? 's' : ''} Block
                </p>
                <p className="text-[9px] text-gray-400 mt-0.5">{formatDateTime(tx.paidAt)}</p>
              </div>
              <span className="text-sm font-black text-blue-950 dark:text-blue-400">
                ₦{Number(tx.amount).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  )}
</section>

        {/* PRIMARY EDIT PROFILE IDENTITY CONTAINER */}
        <form onSubmit={handleUpdate} className="space-y-8">
          <section className="flex flex-col md:flex-row items-center gap-6 md:gap-10 text-center md:text-left">
            <div className="relative group">
              <div className="w-28 h-28 md:w-36 md:h-36 rounded-[2rem] bg-gray-100 dark:bg-slate-800 border-4 border-white dark:border-slate-900 shadow-xl overflow-hidden">
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

          <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-4">Professional Title</label>
              <input 
                value={agentData.occupation || ''}
                onChange={(e) => setAgentData({...agentData, occupation: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-4">Current Program</label>
              <input 
                value={agentData.program || ''}
                onChange={(e) => setAgentData({...agentData, program: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-4">Office Address</label>
              <input 
                value={agentData.address || ''}
                onChange={(e) => setAgentData({...agentData, address: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main focus:border-blue-600 outline-none transition-all"
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-4">Public Bio</label>
              <textarea 
                rows="3"
                value={agentData.bio || ''}
                onChange={(e) => setAgentData({...agentData, bio: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-2xl px-5 py-3.5 text-sm text-text-main focus:border-blue-600 outline-none transition-all resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-4">Gender</label>
              <div className="relative">
                <select 
                  value={agentData.gender ? agentData.gender.toLowerCase() : ""} 
                  onChange={(e) => setAgentData({...agentData, gender: e.target.value})}
                  className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main focus:border-blue-600 outline-none transition-all appearance-none capitalize"
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
              <label className="text-[8px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 ml-4">Date of Birth</label>
              <input 
                type="date"
                value={agentData.dob ? new Date(agentData.dob).toISOString().slice(0, 10) : ''}
                onChange={(e) => setAgentData({ ...agentData, dob: e.target.value })}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main focus:border-blue-600 outline-none transition-all"
              />
            </div>
          </section>

          {/* THEME SELECTOR CONFIG */}
          <section className="bg-card-bg/50 dark:bg-slate-900/50 p-6 rounded-[2rem] border border-dashed border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-5">
              <BsDisplay className="text-blue-600" size={16} />
              <h3 className="text-[9px] font-black uppercase tracking-[0.15em] text-blue-900 dark:text-blue-400">Display Theme</h3>
            </div>
            
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'light', label: 'Light', icon: <BsSunFill /> },
                { id: 'dark', label: 'Dark', icon: <BsMoonStarsFill /> },
                { id: 'system', label: 'System', icon: <BsDisplay /> }
              ].map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => handleThemeChange(theme.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${
                    activeTheme === theme.id 
                    ? 'bg-blue-600 border-blue-600 text-white shadow-lg' 
                    : 'bg-input-bg border-gray-100 dark:border-slate-800 text-gray-400 dark:text-slate-500 hover:border-blue-400'
                  }`}
                >
                  {theme.icon}
                  <span className="text-[10px] font-black uppercase tracking-wider">{theme.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* SECURITY/PASSWORD RENEWAL MODULE */}
          <section className="bg-card-bg/50 dark:bg-slate-900/50 p-6 rounded-[2rem] border border-dashed border-gray-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-5">
              <BsKeyFill className="text-blue-600" size={16} />
              <h3 className="text-[9px] font-black uppercase tracking-[0.15em] text-blue-900 dark:text-blue-400">Security Credentials</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input 
                type="password" 
                placeholder="Old Password"
                value={passwordData.oldPassword}
                onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main outline-none focus:border-blue-600 transition-all"
              />
              <input 
                type="password" 
                placeholder="New Password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main outline-none focus:border-blue-600 transition-all"
              />
              <input 
                type="password" 
                placeholder="Confirm New"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                className="w-full bg-input-bg border border-gray-100 dark:border-slate-800 rounded-xl px-5 py-3.5 text-sm text-text-main outline-none focus:border-blue-600 transition-all"
              />
            </div>
          </section>

          {/* PERSISTENCE TRIGGER ACTION CONTAINER FOOTER */}
          <footer className="pt-6 border-t border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="text-center sm:text-left">
              <p className="text-[9px] font-black text-blue-950 dark:text-blue-400 uppercase tracking-tighter">Biometric Security Sync</p>
              <p className="text-[7px] text-gray-400 font-bold uppercase tracking-tighter">Verified • {new Date().toLocaleDateString()}</p>
            </div>
            
            <button 
              disabled={isSaving}
              type="submit"
              className="w-full sm:w-auto px-8 py-3.5 bg-blue-950 dark:bg-blue-600 text-white rounded-xl font-black text-[9px] uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:bg-blue-800 dark:hover:bg-blue-500 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isSaving ? "Syncing..." : "Update Identity"} <BsCloudUpload />
            </button>
          </footer>
        </form>
      </main>
    </div>
  );
};