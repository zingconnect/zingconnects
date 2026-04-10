import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsSearch, 
  BsThreeDotsVertical, 
  BsCheckAll,
  BsPersonCircle,
  BsChevronLeft,
  BsShieldLockFill,
  BsCreditCard2BackFill,
  BsCheckCircleFill
} from 'react-icons/bs';

export const AgentDashboard = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [agentData, setAgentData] = useState(null);
  const [users, setUsers] = useState([]); 
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  
  // Subscription States
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("BASIC");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);

  // --- PLANS CONFIGURATION ---
  const plans = [
    {
      tier: 'BASIC',
      term: '1 Month',
      price: 15,
      frequency: '/mo',
      popular: false,
      features: ['Instant Link', 'Unlimited Chats', 'Dashboard'],
    },
    {
      tier: 'GROWTH',
      term: '6 Months',
      price: 45,
      frequency: '',
      popular: true,
      features: ['All Basic', 'Priority Routing', '24/7 Support'],
    },
    {
      tier: 'PROFESSIONAL',
      term: '1 Year',
      price: 110,
      frequency: '',
      popular: false,
      features: ['All Growth', 'Voice Changer', 'Analytics'],
    },
  ];

  // --- INITIAL FETCH & SCRIPT LOAD ---
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://checkout.flutterwave.com/v3.js";
    script.async = true;
    document.body.appendChild(script);

    const fetchInitialData = async () => {
      const token = localStorage.getItem('zingToken');
      if (!token) return navigate('/');

      try {
        const profileRes = await fetch('/api/agents/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!profileRes.ok) {
            const errorMsg = await profileRes.json();
            console.error("Profile Error:", errorMsg);
            return;
        }
      const profileData = await profileRes.json();
        setAgentData(profileData);
        setIsSubscribed(profileData.isSubscribed && !profileData.isExpired);
        if (profileData.plan) setSelectedPlan(profileData.plan);

        if (profileData.isSubscribed) {
          const response = await fetch('/api/agents/my-users', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const userData = await response.json();
          
          if (userData.success && Array.isArray(userData.users)) {
            setUsers(userData.users);

            // SYNC SELECTED USER: Update the currently viewed user with fresh data (signed URLs)
            setSelectedUser(prev => {
              if (!prev) return null;
              return userData.users.find(u => u._id === prev._id) || prev;
            });
            
          } else {
            setUsers([]);
          }
        }
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchInitialData();
    return () => {
        if (document.body.contains(script)) {
            document.body.removeChild(script);
        }
    };
  }, [navigate]);

  const handlePayment = async () => {
    if (!agentData || !agentData.email) {
      alert("Profile data is still loading. Please wait a moment or refresh.");
      return;
    }
    setPaymentProcessing(true);
    const token = localStorage.getItem('zingToken');
    const activePlan = plans.find(p => p.tier === selectedPlan);

    if (!activePlan) {
      alert("Invalid plan selected");
      setPaymentProcessing(false);
      return;
    }

    try {
      const rateRes = await fetch(`/api/subscriptions/rate/${activePlan.price}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!rateRes.ok) throw new Error("Could not fetch current exchange rate");
      
      const rateData = await rateRes.json();
      const finalNairaAmount = rateData.ngn; 

      window.FlutterwaveCheckout({
        public_key: import.meta.env.VITE_FLW_PUBLIC_KEY,
        tx_ref: `ZING-${Date.now()}`,
        amount: finalNairaAmount,
        currency: "NGN",
        payment_options: "card, account, transfer, ussd",
        customer: {
          email: agentData?.email,
          name: `${agentData?.firstName} ${agentData?.lastName}`,
        },
        customizations: {
          title: "ZingConnect",
          description: `Activation for ${activePlan.tier} Plan ($${activePlan.price})`,
          logo: "https://cdn-icons-png.flaticon.com/512/9431/9431166.png",
        },
        callback: async (response) => {
          try {
            const verifyRes = await fetch('/api/subscriptions/verify', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                transaction_id: response.transaction_id,
                plan: activePlan.tier,
                usdAmount: activePlan.price 
              })
            });

            if (verifyRes.ok) {
              setShowSuccessOverlay(true);
              setTimeout(() => {
                window.location.reload(); 
              }, 4000);
            } else {
              const errData = await verifyRes.json();
              alert(errData.message || "Verification failed");
            }
          } catch (err) {
            console.error("Verification error:", err);
            alert("Connection error during verification.");
          } finally {
            setPaymentProcessing(false);
          }
        },
        onclose: () => {
          setPaymentProcessing(false);
        }
      });
    } catch (err) {
      console.error("Payment Initialization Error:", err);
      alert("Failed to initialize payment. Please check your connection.");
      setPaymentProcessing(false);
    }
  };

  const handleLogout = () => {
    const currentSlug = agentData.slug;
    localStorage.removeItem('zingToken');
    if (currentSlug) {
      window.location.href = `/${currentSlug}`;
    } else {
      window.location.href = '/';
    }
  };

  const handleSelectUser = (user) => {
    setSelectedUser(user);
    if (window.innerWidth < 1024) setShowSidebar(false);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    const msg = {
      id: Date.now(),
      text: newMessage,
      sender: 'agent',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages([...messages, msg]);
    setNewMessage('');
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#f0f2f5] text-[10px] font-bold uppercase tracking-widest text-gray-400">
      Initializing Secure Portal...
    </div>
  );

  return (
    <div className="h-screen w-screen bg-[#f0f2f5] flex overflow-hidden font-sans antialiased text-slate-900 relative">
      
    {showSuccessOverlay && (
      <div className="fixed inset-0 z-[20000] bg-blue-600 flex flex-col items-center justify-center text-white p-6">
        <div className="bg-white/10 p-6 rounded-full mb-6">
           <BsCheckCircleFill size={60} className="text-white animate-bounce" />
        </div>
        <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter mb-2 text-center">
          Activation Successful!
        </h1>
        <p className="text-sm md:text-lg font-medium opacity-90 text-center max-w-xs mb-8">
          Your <strong>{selectedPlan}</strong> plan ($ {plans.find(p => p.tier === selectedPlan)?.price}) has been activated. Your users can now connect to your secure node.
        </p>
        <div className="flex flex-col items-center gap-4 w-full max-w-xs">
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-white text-blue-600 font-black py-4 rounded-xl shadow-xl active:scale-95 uppercase tracking-widest text-[11px]"
          >
            Return to Dashboard
          </button>
          <p className="text-[10px] uppercase font-bold tracking-[0.2em] opacity-60">
            Redirecting in 4 seconds...
          </p>
        </div>
      </div>
    )}

      {!isSubscribed && !showSuccessOverlay && (
        <div className="absolute inset-0 z-[10000] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row animate-in fade-in zoom-in duration-300 max-h-[90vh] md:max-h-none overflow-y-auto">
            <div className="bg-blue-600 p-6 md:p-10 text-white md:w-1/3 flex flex-col justify-between border-b md:border-b-0 md:border-r border-blue-500">
              <div>
                <BsShieldLockFill size={32} className="mb-4 opacity-90" />
                <h2 className="text-xl md:text-3xl font-black uppercase tracking-tighter leading-none mb-3">Account Inactive</h2>
                <p className="text-blue-100 text-[11px] md:text-sm leading-relaxed opacity-90">
                  Access to your dashboard, leads, and encrypted messaging requires an active subscription.
                </p>
              </div>
              <div className="mt-8 pt-8 border-t border-blue-500/50 hidden md:block">
                <p className="text-[10px] uppercase font-bold tracking-widest opacity-60 mb-1">Current Selection</p>
                <p className="text-3xl font-black">{selectedPlan}</p>
              </div>
            </div>

            <div className="p-6 md:p-12 md:w-2/3 bg-gray-50 flex flex-col">
              <h3 className="text-sm md:text-xl font-bold text-gray-800 mb-6">Choose Your Access Tier</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {plans.map((plan) => (
                  <div 
                    key={plan.tier}
                    onClick={() => setSelectedPlan(plan.tier)}
                    className={`cursor-pointer p-4 rounded-2xl border-2 transition-all duration-300 relative flex flex-col justify-between ${
                      selectedPlan === plan.tier 
                        ? 'border-blue-600 bg-white shadow-xl scale-[1.03] z-10' 
                        : 'border-gray-200 bg-white hover:border-blue-300 opacity-80'
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[9px] font-black uppercase tracking-widest ${selectedPlan === plan.tier ? 'text-blue-600' : 'text-gray-400'}`}>
                          {plan.tier}
                        </span>
                        {selectedPlan === plan.tier && <BsCheckCircleFill className="text-blue-600" size={16} />}
                      </div>
                      <div className="text-xl md:text-2xl font-black text-gray-900 leading-none">
                        ${plan.price}
                        <span className="text-[10px] font-normal text-gray-400 ml-1">{plan.frequency}</span>
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase mt-1 tracking-tight">{plan.term}</p>
                    </div>
                    {plan.popular && (
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg">
                        Best Value
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-white p-5 md:p-8 rounded-2xl border border-gray-100 shadow-sm flex flex-col">
                <div className="flex items-center gap-3 mb-4 text-gray-800">
                  <BsCreditCard2BackFill size={18} className="text-blue-600" />
                  <span className="text-xs md:text-sm font-bold uppercase tracking-wide">Summary & Checkout</span>
                </div>
                <p className="text-[11px] md:text-sm text-gray-500 mb-6 leading-relaxed">
                  Activating <strong>{selectedPlan}</strong> access for <strong>${plans.find(p => p.tier === selectedPlan)?.price}</strong>. 
                </p>
                <button 
                  disabled={paymentProcessing}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-4 rounded-xl transition-all shadow-lg active:scale-[0.97] uppercase tracking-widest text-[11px]"
                  onClick={handlePayment}
                >
                  {paymentProcessing ? "Processing..." : `Activate ${selectedPlan} Access`}
                </button>
                <p className="text-[9px] text-center text-gray-400 mt-4 uppercase tracking-tighter font-medium italic">
                  Instant Activation • 256-bit SSL Encryption
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-[30%] lg:min-w-[350px] bg-white border-r border-gray-300 flex-col z-[100]`}>
        <header className="h-[50px] md:h-[60px] bg-[#f0f2f5] px-3 flex justify-between items-center border-b border-gray-200 shrink-0">
          <button onClick={() => navigate('/agent/profile')} className="h-10 w-10 rounded-full hover:bg-gray-200 flex items-center justify-center">
            <BsPersonCircle size={32} className="text-gray-400" />
          </button>
          <BsThreeDotsVertical className="cursor-pointer text-gray-500" size={18} />
        </header>

        <div className="p-2 bg-white">
          <div className="bg-[#f0f2f5] flex items-center px-3 py-1.5 rounded-lg">
            <BsSearch className="text-gray-500 mr-3" size={12} />
            <input placeholder="Search" className="bg-transparent text-xs w-full outline-none" />
          </div>
        </div>

        {/* User list in sidebar */}
{/* User list in sidebar */}
<div className="flex-1 overflow-y-auto">
  {users.length > 0 ? users.map((user) => (
    <div 
      key={user._id}
      onClick={() => handleSelectUser(user)}
      className={`flex items-center px-4 py-3 cursor-pointer hover:bg-[#f5f6f6] border-b border-gray-50 transition-colors ${
        selectedUser?._id === user._id ? 'bg-[#ebebeb]' : ''
      }`}
    >
      <div className="relative shrink-0">
        <div className="w-11 h-11 rounded-full overflow-hidden border border-gray-200 bg-white flex items-center justify-center">
          <img 
            src={user.photoUrl} 
            alt="User" 
            className="w-full h-full object-cover"
            onError={(e) => {
              // If the S3 URL fails, this replaces it with a clean UI-Avatar
              console.warn(`S3 Load failed for ${user.email}, switching to fallback.`);
              e.target.onerror = null; // Prevents infinite loops
              e.target.src = `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=random&color=fff`;
            }} 
          />
        </div>
        
        {/* Status indicator */}
        <div className={`absolute -bottom-0.5 -right-0.5 border-2 border-white w-4 h-4 rounded-full flex items-center justify-center ${user.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}>
          {user.isVerified && <BsCheckAll className="text-white" size={12} />}
        </div>
      </div>

      <div className="ml-3 flex-1 overflow-hidden">
        <div className="flex flex-col justify-center">
          <h3 className="text-[13px] font-bold text-gray-800 truncate leading-tight">
            {user.firstName ? `${user.firstName} ${user.lastName}` : 'Unknown User'}
          </h3>
          {/* Email displays below name */}
          <p className="text-[11px] font-medium text-gray-500 lowercase truncate leading-tight mb-0.5">
            {user.email}
          </p>
        </div>
        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter truncate">
          {user.city}, {user.state} • <span className={user.status === 'online' ? 'text-green-600' : 'text-gray-400'}>
            {user.status === 'online' ? 'Online' : 'Offline'}
          </span>
        </p>
      </div>
    </div>
  )) : (
    <p className="text-center text-gray-500 py-10">No users connected.</p>
  )}
</div>
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-red-100 text-red-500 rounded-xl hover:bg-red-50 hover:text-red-600 transition-all duration-200 group shadow-sm active:scale-95"
          >
            <div className="bg-red-50 group-hover:bg-red-100 p-2 rounded-lg transition-colors">
              <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
            </div>
            <span className="text-[11px] font-black uppercase tracking-widest">Disconnect Session</span>
          </button>
        </div>
      </aside>

      <main className={`${!showSidebar ? 'flex' : 'hidden'} lg:flex flex-1 flex-col bg-[#efeae2] relative overflow-hidden`}>
        {selectedUser ? (
          <>
        <header className="h-[55px] md:h-[65px] bg-[#f0f2f5] px-3 flex justify-between items-center z-10 border-l border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
  <button onClick={() => setShowSidebar(true)} className="lg:hidden p-2 text-gray-600 hover:bg-gray-200 rounded-full transition-colors">
    <BsChevronLeft size={18} />
  </button>
  
  <div className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden border border-gray-200 bg-white shrink-0 shadow-sm">
    <img 
  src={selectedUser.photoUrl} 
  alt="Profile" 
  className="w-full h-full object-cover" 
  onError={(e) => {
    e.target.onerror = null; 
    e.target.src = `https://ui-avatars.com/api/?name=${selectedUser.firstName}+${selectedUser.lastName}&background=random&color=fff`;
  }}
/>
  </div>

  <div className="overflow-hidden flex flex-col justify-center">
    {/* Name Row */}
    <h2 className="text-sm font-bold text-gray-800 truncate max-w-[140px] md:max-w-none leading-tight">
      {selectedUser.firstName ? `${selectedUser.firstName} ${selectedUser.lastName}` : 'Unknown User'}
    </h2>

    {/* Email Row - Added below the name */}
    <p className="text-[11px] font-medium text-gray-500 lowercase truncate leading-tight">
      {selectedUser.email}
    </p>

    {/* Status Row */}
    <div className="flex items-center gap-1.5 mt-0.5">
      <span className={`w-1.5 h-1.5 rounded-full ${selectedUser.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
      <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">
        {selectedUser.city ? `${selectedUser.city}, ${selectedUser.state}` : 'Verified Node'}
      </p>
    </div>
  </div>
</div>
          <div className="flex items-center gap-4 md:gap-6 text-gray-500 mr-2">
            <button className="hover:text-blue-600 transition-colors active:scale-90" title="Video Call">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 12V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm6.79-4.493c0 .407.303.74.686.74.384 0 .687-.333.687-.74 0-.406-.303-.74-.687-.74-.383 0-.686.334-.686.74zM3.733 4.493c0 .407.303.74.687.74.383 0 .686-.333.686-.74 0-.406-.303-.74-.686-.74-.384 0-.687.334-.687.74zM14 1h-3l1 2h2V1zM5 1H2L1 3h2V1zM15 4h-4l1 2h3V4zM4 4H0l1 2h3V4zm1 10h4l-1-2H2v2zm10 0h-3l-1-2h4v2z"/>
              </svg>
            </button>
            <button className="hover:text-blue-600 transition-colors active:scale-90" title="Voice Call">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 0 0 4.168 6.608 17.569 17.569 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.678.678 0 0 0-.58-.122l-2.19.547a1.745 1.745 0 0 1-1.657-.459L5.482 8.062a1.745 1.745 0 0 1-.46-1.657l.548-2.19a.678.678 0 0 0-.122-.58L3.654 1.328z"/>
              </svg>
            </button>
            <div className="h-6 w-[1px] bg-gray-300 mx-1 hidden md:block"></div>
            <BsThreeDotsVertical className="cursor-pointer hover:text-blue-600 transition-colors" size={18} />
          </div>
        </header>
            <div className="flex-1 overflow-y-auto p-4 md:px-20 space-y-2 z-10 flex flex-col">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[85%] md:max-w-[65%] px-3 py-1.5 rounded-lg shadow-sm relative ${m.sender === 'agent' ? 'bg-[#dcf8c6] self-end' : 'bg-white self-start'}`}>
                  <p className="text-xs md:text-[13px] text-[#303030] leading-relaxed">{m.text}</p>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[9px] text-gray-400">{m.time}</span>
                    {m.sender === 'agent' && <BsCheckAll size={14} className="text-blue-400" />}
                  </div>
                </div>
              ))}
            </div>

            <footer className="min-h-[60px] bg-[#f0f2f5] px-2 md:px-4 py-2 flex items-center gap-2 z-10 border-t border-gray-200">
              <div className="flex items-center gap-1 md:gap-3 text-gray-500">
                <button className="p-2 hover:bg-gray-200 rounded-full transition-all active:scale-90" title="Attach Document">
                  <svg stroke="currentColor" fill="none" strokeWidth="2" viewBox="0 0 24 24" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>
                <button className="p-2 hover:bg-gray-200 rounded-full transition-all hidden md:block active:scale-90" title="Camera">
                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1.172a3 3 0 0 0 2.12-.879l.83-.828A1 1 0 0 1 7.07 3h1.858a1 1 0 0 1 .707.293l.83.828a3 3 0 0 0 2.12.879H14a1 1 0 0 1 1 1v6zM2 4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1.172a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 9.172 2H6.828a2 2 0 0 0-1.414.586l-.828.828A2 2 0 0 1 3.172 4H2z"/>
                    <path d="M8 11a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zm0 1a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSendMessage} className="flex-1 flex items-center gap-2">
                <input 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message"
                  className="flex-1 bg-white px-4 py-2.5 rounded-full text-sm outline-none border border-gray-200 focus:border-blue-300 transition-all"
                />
                <button 
                  type="submit"
                  className={`p-3 rounded-full transition-all active:scale-90 shadow-md ${
                    newMessage.trim() ? 'bg-blue-600 text-white' : 'bg-gray-400 text-white'
                  }`}
                >
                  {newMessage.trim() ? (
                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                      <path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576 6.636 10.07Zm6.787-8.201L1.591 6.602l4.339 2.76 7.494-7.493Z"/>
                    </svg>
                  ) : (
                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="18" width="18" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h2.5a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1H7v-2.025A5 5 0 0 1 2.5 8V7a.5.5 0 0 1 .5-.5z"/>
                      <path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V3z"/>
                    </svg>
                  )}
                </button>
              </form>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-30">
            <BsShieldLockFill size={40} className="mb-4" />
            <h1 className="text-2xl font-black uppercase tracking-widest text-blue-950">ZingConnect</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest">Secure Terminal</p>
          </div>
        )}
      </main>
    </div>
  );
};