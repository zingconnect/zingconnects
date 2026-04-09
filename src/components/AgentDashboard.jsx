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
    // 1. Load Flutterwave Script
    const script = document.createElement('script');
    script.src = "https://checkout.flutterwave.com/v3.js";
    script.async = true;
    document.body.appendChild(script);

    // 2. Fetch Profile Data
    const fetchInitialData = async () => {
      const token = localStorage.getItem('zingToken');
      if (!token) return navigate('/');

      try {
        const profileRes = await fetch('/api/agents/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const profileData = await profileRes.json();
        
        setAgentData(profileData);
        setIsSubscribed(profileData.isSubscribed); 
        if (profileData.plan) setSelectedPlan(profileData.plan);

        if (profileData.isSubscribed) {
          const response = await fetch('/api/agents/my-users', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await response.json();
          setUsers(data || []);
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

  // --- UPDATED PAYMENT HANDLER ---
  const handlePayment = async () => {
    setPaymentProcessing(true);
    const token = localStorage.getItem('zingToken');

    // Find the plan object based on what the user has selected in the UI
    const activePlan = plans.find(p => p.tier === selectedPlan);

    if (!activePlan) {
      alert("Invalid plan selected");
      setPaymentProcessing(false);
      return;
    }

    try {
      // 1. Fetch the converted Naira amount from your backend
      const rateRes = await fetch(`/api/subscriptions/rate/${activePlan.price}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!rateRes.ok) throw new Error("Could not fetch current exchange rate");
      
      const rateData = await rateRes.json();
      const finalNairaAmount = rateData.ngn; 

      // 2. Launch Flutterwave with NGN to enable Bank/Transfer options
      window.FlutterwaveCheckout({
        public_key: "FLWPUBK_TEST-480bbaa21db77a566071155d05ff5dc4-X",
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
            // 3. Verify on backend using original USD amount for validation logic
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
        <div className="absolute inset-0 z-[20000] bg-blue-600 flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-500">
          <BsCheckCircleFill size={80} className="mb-6 animate-bounce" />
          <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-4 text-center">Congratulations!</h1>
          <p className="text-lg md:text-xl font-medium opacity-90 text-center max-w-md">
            Your <strong>{selectedPlan}</strong> subscription has been paid and is ready to use.
          </p>
          <div className="mt-8 flex items-center gap-2">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            <p className="text-[10px] uppercase font-bold tracking-[0.2em]">Unlocking Dashboard</p>
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

        <div className="flex-1 overflow-y-auto">
          {users.length > 0 ? users.map((user) => (
            <div 
              key={user._id}
              onClick={() => handleSelectUser(user)}
              className={`flex items-center px-3 py-3 cursor-pointer hover:bg-[#f5f6f6] border-b border-gray-50 ${selectedUser?._id === user._id ? 'bg-[#ebebeb]' : ''}`}
            >
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">
                {user.email[0].toUpperCase()}
              </div>
              <div className="ml-3 flex-1 overflow-hidden">
                <h3 className="text-[13px] font-bold text-gray-800 truncate">{user.email}</h3>
                <p className="text-[11px] text-gray-500 truncate">Connected</p>
              </div>
            </div>
          )) : (
            <div className="p-10 text-center opacity-30">
                <p className="text-[10px] uppercase font-black tracking-widest">No Connections</p>
            </div>
          )}
        </div>
      </aside>

      <main className={`${!showSidebar ? 'flex' : 'hidden'} lg:flex flex-1 flex-col bg-[#efeae2] relative overflow-hidden`}>
        {selectedUser ? (
          <>
            <header className="h-[50px] md:h-[60px] bg-[#f0f2f5] px-3 flex justify-between items-center z-10 border-l border-gray-200 shadow-sm">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowSidebar(true)} className="lg:hidden p-2 text-gray-600">
                  <BsChevronLeft size={18} />
                </button>
                <div className="w-9 h-9 bg-blue-900 rounded-full flex items-center justify-center text-white text-xs font-black">
                  {selectedUser.email[0].toUpperCase()}
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-800 truncate">{selectedUser.email}</h2>
                  <p className="text-[9px] text-green-600 font-bold uppercase">Online</p>
                </div>
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

            <footer className="min-h-[55px] bg-[#f0f2f5] px-3 py-2 flex items-center z-10 border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex-1">
                <input 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message"
                  className="w-full bg-white px-4 py-2.5 rounded-full text-sm outline-none border border-gray-200"
                />
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