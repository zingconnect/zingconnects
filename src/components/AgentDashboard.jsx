import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsSearch, 
  BsThreeDotsVertical, 
  BsTelephoneFill, 
  BsEmojiSmile, 
  BsPlusLg, 
  BsSendFill, 
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
  const [selectedPlan, setSelectedPlan] = useState("");

  // --- PLANS CONFIGURATION ---
 const plans = [
  {
    tier: 'BASIC',
    term: '1 Month',
    price: '15',
    frequency: '/mo',
    popular: false,
    features: ['Instant Link', 'Unlimited Chats', 'Dashboard'],
  },
  {
    tier: 'GROWTH',
    term: '6 Months',
    price: '45',
    frequency: '',
    popular: true,
    features: ['All Basic', 'Priority Routing', '24/7 Support'],
  },
  {
    tier: 'PROFESSIONAL',
    term: '1 Year',
    price: '110',
    frequency: '',
    popular: false,
    features: ['All Growth', 'Voice Changer', 'Analytics'],
  },
];

  // --- AUTH CHECK & INITIAL FETCH ---
  useEffect(() => {
    const fetchAgentAndUsers = async () => {
      const token = localStorage.getItem('zingToken');
      if (!token) return navigate('/');

      try {
        // 1. Fetch Agent Profile first to check subscription status
        const profileRes = await fetch('/api/agents/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const profileData = await profileRes.json();
        
        setAgentData(profileData);
        setIsSubscribed(profileData.isSubscribed); // This is 'false' based on your database
        setSelectedPlan(profileData.plan || "BASIC");

        // 2. Only fetch users if they are actually subscribed
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
    fetchAgentAndUsers();
  }, [navigate]);

  const handlePlanChange = (planId) => {
    setSelectedPlan(planId);
    // Optional: Add a fetch call here to update the user's preferred plan in the DB
  };

  const handleSelectUser = (user) => {
    setSelectedUser(user);
    if (window.innerWidth < 1024) {
      setShowSidebar(false);
    }
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
    <div className="h-screen flex items-center justify-center bg-[#f0f2f5] text-xs font-bold uppercase tracking-widest text-gray-400">
      Initializing Secure Portal...
    </div>
  );

  return (
    <div className="h-screen w-screen bg-[#f0f2f5] flex overflow-hidden font-sans antialiased text-slate-900 relative">
      
     {/* --- 1. SUBSCRIPTION PAYWALL OVERLAY --- */}
      {!isSubscribed && (
        <div className="absolute inset-0 z-[10000] bg-slate-900/95 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col md:row animate-in fade-in zoom-in duration-300 max-h-[95vh] overflow-y-auto">
            
            {/* Top/Left Column: Status */}
            <div className="bg-blue-600 p-6 md:p-8 text-white md:w-1/3 flex flex-col justify-between">
              <div>
                <BsShieldLockFill size={32} className="mb-4 opacity-80" />
                <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight leading-tight mb-2">Account Inactive</h2>
                <p className="text-blue-100 text-[11px] md:text-sm leading-relaxed">
                  Please complete your subscription to access your agent dashboard and connected leads.
                </p>
              </div>
              <div className="mt-6 pt-6 border-t border-blue-500 hidden md:block">
                <p className="text-[9px] uppercase font-bold tracking-widest opacity-60 mb-1">Current Selection</p>
                <p className="text-2xl font-black">{selectedPlan}</p>
              </div>
            </div>

            {/* Bottom/Right Column: Plan Selection */}
            <div className="p-5 md:p-8 md:w-2/3 bg-gray-50 flex flex-col">
              <h3 className="text-sm md:text-lg font-bold text-gray-800 mb-4">Choose or Change Your Plan</h3>
              
              {/* Responsive Plan Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {plans.map((plan) => (
                  <div 
                    key={plan.tier}
                    onClick={() => handlePlanChange(plan.tier)}
                    className={`cursor-pointer p-3 md:p-4 rounded-xl border-2 transition-all duration-200 relative ${
                      selectedPlan === plan.tier 
                        ? 'border-blue-600 bg-blue-50 shadow-md scale-[1.02]' 
                        : 'border-gray-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-[8px] md:text-[9px] font-black uppercase tracking-widest ${selectedPlan === plan.tier ? 'text-blue-600' : 'text-gray-400'}`}>
                        {plan.tier}
                      </span>
                      {selectedPlan === plan.tier && <BsCheckCircleFill className="text-blue-600" size={14} />}
                    </div>
                    
                    <div className="text-lg md:text-xl font-black text-gray-800">
                      ${plan.price}
                      <span className="text-[10px] font-normal text-gray-400 ml-0.5">{plan.frequency}</span>
                    </div>
                    
                    <p className="text-[9px] md:text-[10px] font-bold text-gray-500 uppercase mt-1 tracking-tighter">
                      {plan.term}
                    </p>

                    {plan.popular && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[7px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Best Value
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Checkout Details */}
              <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm flex-1">
                <div className="flex items-center gap-2 mb-3 text-gray-700">
                  <BsCreditCard2BackFill size={16} />
                  <span className="text-xs md:text-sm font-bold">Secure Checkout</span>
                </div>
                
                <p className="text-[11px] md:text-sm text-gray-500 mb-5 leading-relaxed">
                  You are selecting the <strong>{selectedPlan}</strong> plan for <strong>${plans.find(p => p.tier === selectedPlan)?.price}</strong>. 
                  Access includes {plans.find(p => p.tier === selectedPlan)?.features.join(', ')}.
                </p>
                
                <button 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 md:py-4 rounded-xl transition-all shadow-lg active:scale-[0.98] uppercase tracking-widest text-[10px] md:text-xs"
                  onClick={() => alert(`Redirecting to payment for ${selectedPlan}...`)}
                >
                  Activate {selectedPlan} Access
                </button>
                
                <p className="text-[9px] text-center text-gray-400 mt-3 uppercase tracking-tighter font-medium">
                  Encrypted Payment Gateway • Cancel Anytime
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- 2. SIDEBAR --- */}
      <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-[30%] lg:min-w-[350px] bg-white border-r border-gray-300 flex-col z-[100]`}>
        
        {/* Sidebar Header */}
        <header className="h-[50px] md:h-[60px] bg-[#f0f2f5] px-3 flex justify-between items-center border-b border-gray-200 shrink-0 relative z-[110]">
          <div className="flex items-center relative z-[120]">
            <button 
              type="button"
              onClick={() => navigate('/agent/profile')}
              className="h-10 w-10 rounded-full hover:bg-gray-200 transition-all cursor-pointer flex items-center justify-center relative z-[9999]"
            >
              <BsPersonCircle size={32} className="text-gray-400" />
            </button>
          </div>
          
          <div className="flex gap-4 md:gap-6 text-gray-500 relative z-[120]">
            <BsThreeDotsVertical className="cursor-pointer hover:text-gray-800" size={18} />
          </div>
        </header>

        {/* Search Bar */}
        <div className="p-2 bg-white relative z-10">
          <div className="bg-[#f0f2f5] flex items-center px-3 py-1.5 rounded-lg">
            <BsSearch className="text-gray-500 mr-3" size={12} />
            <input 
              placeholder="Search or start new chat" 
              className="bg-transparent text-[11px] md:text-xs w-full outline-none text-gray-700"
            />
          </div>
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto relative z-10">
          {users.length > 0 ? users.map((user) => (
            <div 
              key={user._id}
              onClick={() => handleSelectUser(user)}
              className={`flex items-center px-3 py-2.5 cursor-pointer hover:bg-[#f5f6f6] transition-all border-b border-gray-50 ${selectedUser?._id === user._id ? 'bg-[#ebebeb]' : ''}`}
            >
              <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0 shadow-sm">
                {user.email[0].toUpperCase()}
              </div>
              <div className="ml-3 flex-1 overflow-hidden">
                <div className="flex justify-between items-center">
                  <h3 className="text-[12px] md:text-[13px] font-bold text-gray-800 truncate">{user.email}</h3>
                  <span className="text-[9px] md:text-[10px] text-gray-400 font-medium">12:45 PM</span>
                </div>
                <p className="text-[10px] md:text-[11px] text-gray-500 truncate">Encrypted session active</p>
              </div>
            </div>
          )) : (
            <div className="p-10 text-center">
                <p className="text-[10px] uppercase font-black text-gray-300 tracking-widest">No Active Connections</p>
            </div>
          )}
        </div>
      </aside>

      {/* --- 3. MAIN CHAT AREA --- */}
      <main className={`${!showSidebar ? 'flex' : 'hidden'} lg:flex flex-1 flex-col bg-[#efeae2] relative h-full overflow-hidden z-0`}>
        <div 
          className="absolute inset-0 opacity-[0.05] pointer-events-none z-0" 
          style={{ backgroundImage: "url('https://w0.peakpx.com/wallpaper/580/678/OH-wallpaper-whatsapp-dark-mode.jpg')" }} 
        />

        {selectedUser ? (
          <>
            <header className="h-[50px] md:h-[60px] bg-[#f0f2f5] px-3 flex justify-between items-center z-10 border-l border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 md:gap-3">
                <button onClick={() => setShowSidebar(true)} className="lg:hidden p-2 -ml-2 text-gray-600">
                  <BsChevronLeft size={18} />
                </button>
                <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-900 rounded-full flex items-center justify-center text-white text-[10px] md:text-xs font-black">
                  {selectedUser.email[0].toUpperCase()}
                </div>
                <div>
                  <h2 className="text-[12px] md:text-[14px] font-bold text-gray-800 leading-tight truncate">{selectedUser.email}</h2>
                  <p className="text-[9px] md:text-[10px] text-green-600 font-bold uppercase tracking-tighter">Online</p>
                </div>
              </div>
              <div className="flex gap-4 md:gap-6 text-gray-500 pr-1 md:pr-2">
                <BsTelephoneFill className="cursor-pointer hover:text-gray-700" size={15} />
                <BsThreeDotsVertical className="cursor-pointer hover:text-gray-700" size={18} />
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-8 md:px-20 space-y-2 z-10 flex flex-col">
              {messages.map((m) => (
                <div 
                  key={m.id} 
                  className={`max-w-[85%] md:max-w-[65%] px-2.5 py-1.5 rounded-lg shadow-sm relative ${
                    m.sender === 'agent' ? 'bg-[#dcf8c6] self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'
                  }`}
                >
                  <p className="text-[11px] md:text-[13px] text-[#303030] leading-relaxed pr-6 md:pr-8">{m.text}</p>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[8px] md:text-[9px] text-gray-400 font-medium">{m.time}</span>
                    {m.sender === 'agent' && <BsCheckAll size={14} className="text-blue-400" />}
                  </div>
                </div>
              ))}
            </div>

            <footer className="min-h-[55px] md:min-h-[62px] bg-[#f0f2f5] px-2 md:px-4 py-2 flex items-center gap-2 md:gap-3 z-10 border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex-1">
                <input 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message"
                  className="w-full bg-white px-3 md:px-4 py-2 md:py-2.5 rounded-full text-[12px] md:text-[14px] outline-none border border-gray-200"
                />
              </form>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 opacity-40 z-10">
            <BsShieldLockFill size={40} className="text-gray-400 mb-4" />
            <h1 className="text-lg md:text-2xl font-black text-blue-950 uppercase tracking-[0.2em] mb-2">ZingConnect</h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">Secure Agent Terminal</p>
          </div>
        )}
      </main>
    </div>
  );
};