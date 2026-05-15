import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from "socket.io-client"; // ADD THIS
import { 
  BsGrid1X2Fill, 
  BsPeopleFill, 
  BsGearFill, 
  BsList, 
  BsPersonBadgeFill,
  BsShieldLockFill,
  BsCashStack,
  BsGraphUpArrow,
  BsEyeFill,
  BsXCircleFill,
  BsCheckCircleFill,
  BsHeadset, 
  BsSendFill,
  BsPersonFill,
  BsBellFill
} from 'react-icons/bs';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

const ZingDashboard = () => {
  const [stats, setStats] = useState({ 
    totalAgents: 0, 
    pendingAgents: 0, 
    revenue: { daily: 0, weekly: 0, monthly: 0, yearly: 0 },
    chartData: [] 
  });
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [loading, setLoading] = useState(false);
  const [activeChat, setActiveChat] = useState(null);
  const [guests, setGuests] = React.useState([]);
  const [socket, setSocket] = useState(null); 
  const [broadcastTarget, setBroadcastTarget] = useState('all'); // 'all' or 'selected'
const [selectedEmails, setSelectedEmails] = useState([]);
const [newsSubject, setNewsSubject] = useState("");
const [newsContent, setNewsContent] = useState("");
const [sendingNews, setSendingNews] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const navigate = useNavigate();

const guestsOnlyThreads = (guests || []).map(g => ({
  ...g,
  isGuest: true,
  displayName: `Guest #${g._id.slice(-4)}`,
  subtitle: 'Public Visitor'
}));

const toggleEmailSelection = (email) => {
  setSelectedEmails(prev => 
    prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
  );
};
// --- ADD THIS TO ZINGDASHBOARD ---
useEffect(() => {
  const newSocket = io("https://zingconnect.vercel.app"); // Your backend URL
  setSocket(newSocket);

  return () => newSocket.close();
}, []);

useEffect(() => {
  const fetchStats = async () => {
    const token = localStorage.getItem('adminToken');
    if (!token) {
      navigate('/admin/terminal');
      return;
    }

    try {
      const response = await fetch('https://zingconnect.vercel.app/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.status === 401) {
        localStorage.removeItem('adminToken');
        navigate('/admin/terminal');
        return;
      }

      const data = await response.json();
      if (data.success) {
        setStats(data);
      }
    } catch (err) {
      console.error("Dashboard refresh error:", err);
    }
  };
  fetchStats();
}, [navigate]);

  useEffect(() => {
    if (activeTab === 'Agents') {
      const fetchAgents = async () => {
        const token = localStorage.getItem('adminToken');
        try {
          const response = await fetch('https://zingconnect.vercel.app/api/admin/agents', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await response.json();
          if (data.success) setAgents(data.agents);
        } catch (err) {
          console.error("Error fetching agents:", err);
        }
      };
      fetchAgents();
    }
  }, [activeTab]);

useEffect(() => {
  if (activeTab === 'Chat Support') {
    const fetchActiveGuests = async () => {
      const token = localStorage.getItem('adminToken');
      try {
        const response = await fetch('https://zingconnect.vercel.app/api/admin/support/guests', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
          setGuests(data.guests.map(g => ({ ...g, isGuest: true, messages: [] })));
        }
      } catch (err) {
        console.error("Error fetching guest list:", err);
      }
    };
    fetchActiveGuests();
  }
}, [activeTab]);

useEffect(() => {
  if (!socket) return;

  // 1. Handle New Guest Joining
  socket.on("admin_new_guest_online", (data) => {
    setGuests(prev => {
      // Avoid duplicates
      if (prev.find(g => g._id === data.guestId)) return prev;
      return [{ _id: data.guestId, isGuest: true, messages: [] }, ...prev];
    });
  });
socket.on("admin_receive_support_message", (data) => {
  console.log("Admin received message:", data);
  const guestIdentifier = data.guestId; 
  const formattedMsg = {
    _id: data._id, // The unique message ID
    text: data.text,
    isAdmin: data.senderType === "Admin", // Use senderType from your DB schema
    timestamp: new Date(data.createdAt || Date.now()).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  };

  setGuests(prev => {
    const guestExists = prev.find(g => g._id === guestIdentifier);
    if (guestExists) {
      return prev.map(g => g._id === guestIdentifier 
        ? { ...g, messages: [...(g.messages || []), formattedMsg] } 
        : g
      );
    } else {
      return [{ _id: guestIdentifier, isGuest: true, messages: [formattedMsg] }, ...prev];
    }
  });
 setActiveChat(prev => {
      if (prev && prev._id === data.guestId) {
        const newMessage = {
          _id: data._id,
          text: data.text,
          isAdmin: false, // It's from a guest
          timestamp: new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        const exists = prev.messages?.some(m => m._id === data._id);
        if (exists) return prev;

        return { ...prev, messages: [...(prev.messages || []), newMessage] };
      }
      return prev;
    });
});
socket.on("guest_receive_admin_message", (data) => {
     console.log("Admin message broadcast confirmation:", data);
  });

  return () => {
    socket.off("admin_receive_support_message");
    socket.off("guest_receive_admin_message");
  };
}, [socket]);

useEffect(() => {
  if (socket && activeChat && activeChat.isGuest) {
    socket.emit("admin_focus_guest", activeChat._id);
  }
}, [activeChat, socket]);

const handleAdminReply = () => {
  if (!supportMessage.trim() || !activeChat || !socket) return;

  const replyData = {
    guestId: String(activeChat._id),
    text: supportMessage,
    senderType: "Admin" 
  };
  socket.emit("admin_to_guest_message", replyData);
  const localFormattedMsg = {
    _id: Date.now().toString(),
    text: supportMessage,
    isAdmin: true,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  setActiveChat(prev => ({
    ...prev,
    messages: [...(prev.messages || []), localFormattedMsg]
  }));

  setGuests(prev => prev.map(g => 
    g._id === activeChat._id ? { ...g, messages: [...(g.messages || []), localFormattedMsg] } : g
  ));

  setSupportMessage("");
};

const handleSendBroadcast = async () => {
  setSendingNews(true);
  const token = localStorage.getItem('adminToken');
  
  const payload = {
    target: broadcastTarget, // "all" or "selected"
    emails: broadcastTarget === 'selected' ? selectedEmails : [],
    subject: newsSubject,
    message: newsContent
  };

  try {
    const response = await fetch('https://zingconnect.vercel.app/api/admin/broadcast-news', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    if (data.success) {
      alert("News update sent successfully!");
      setNewsContent("");
      setNewsSubject("");
    }
  } catch (err) {
    console.error("Broadcast failed:", err);
  } finally {
    setSendingNews(false);
  }
};

const handleViewAgent = async (agentId) => {
    setLoading(true);
    const token = localStorage.getItem('adminToken');
    try {
      const response = await fetch(`https://zingconnect.vercel.app/api/admin/agents/${agentId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setSelectedAgent(data.agent);
      }
    } catch (err) {
      console.error("Error fetching agent details:", err);
    } finally {
      setLoading(false);
    }
  };

const handleToggleVerification = async (agentId) => {
  try {
    const response = await fetch(`https://zingconnect.vercel.app/api/admin/agents/${agentId}/verify`, {
      method: 'PATCH', 
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
        'Content-Type': 'application/json'
      }
    });
    const result = await response.json();
    if (result.success) {
      setAgents(prev => prev.map(a => a._id === agentId ? { ...a, isVerified: !a.isVerified } : a));
      setSelectedAgent(prev => ({ ...prev, isVerified: !prev.isVerified }));
    }
  } catch (err) {
    console.error("Failed to update status:", err.message);
  }
};

  const menuItems = [
    { name: 'Dashboard', icon: <BsGrid1X2Fill /> },
    { name: 'Agents', icon: <BsPeopleFill /> },
  { name: 'Chat Support', icon: <BsHeadset /> }, 
  { name: 'News Update', icon: <BsBellFill /> }, // NEW ITEM
    { name: 'Settings', icon: <BsGearFill /> },
  ];

  const StatCard = ({ title, value, icon, color, subtext }) => {
  const isRevenue = title?.toUpperCase().includes('REVENUE');
    const displayValue = value ?? 0;
  return (
    <div className="bg-white p-4 md:p-6 rounded-[1.5rem] shadow-sm border border-slate-100 flex items-center justify-between transition-transform hover:scale-[1.02]">
      <div>
        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">
          {title}
        </p>
        <h3 className="text-xl md:text-2xl font-black text-slate-900">
          {isRevenue 
            ? `₦${displayValue.toLocaleString()}` 
            : displayValue.toLocaleString()}
        </h3>
        {subtext && (
          <p className="text-[8px] font-bold text-slate-400 mt-1 uppercase">
            {subtext}
          </p>
        )}
      </div>
      <div className={`${color} p-3 rounded-2xl text-white shadow-lg`}>
        {icon}
      </div>
    </div>
  );
};

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      
      {/* --- SIDEBAR --- */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 lg:flex lg:flex-col`}>
        <div className="h-20 flex items-center justify-center border-b border-white/10">
          <h1 className="text-lg font-black uppercase tracking-[0.3em]">Zing <span className="text-blue-500">Admin</span></h1>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.name}
              onClick={() => { setActiveTab(item.name); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === item.name ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-slate-400 hover:bg-white/5'}`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10">
          <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin/terminal'); }} className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-400/10 transition-all">Logout Session</button>
        </div>
      </aside>
{/* --- MAIN CONTENT --- */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-20 bg-white border-b border-slate-100 flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-900 p-2"><BsList size={24} /></button>
            <h2 className="text-[12px] font-black uppercase tracking-widest text-slate-400">Terminal / <span className="text-slate-900">{activeTab}</span></h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:block text-right">
              <p className="text-[10px] font-black text-slate-900 leading-none">ROOT_ADMIN</p>
              <p className="text-[8px] font-bold text-blue-600 uppercase tracking-tighter">Verified System Access</p>
            </div>
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center border-2 border-white shadow-sm"><BsPersonBadgeFill size={20} /></div>
          </div>
        </header>

        <div className="p-4 md:p-8 space-y-6 overflow-y-auto">
          {/* --- DASHBOARD TAB --- */}
          {activeTab === 'Dashboard' && (
            <>
              {/* --- PRIMARY STATS --- */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <StatCard title="Total Registered Agents" value={stats.totalAgents} icon={<BsPeopleFill size={24} />} color="bg-blue-600" />
                <StatCard title="Awaiting Verification" value={stats.pendingAgents} icon={<BsShieldLockFill size={24} />} color="bg-amber-500" />
              </div>

              {/* --- REVENUE OVERVIEW --- */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Daily Revenue" value={stats.revenue?.daily || 0} icon={<BsCashStack />} color="bg-slate-800" />
                <StatCard title="Weekly Revenue" value={stats.revenue?.weekly || 0} icon={<BsCashStack />} color="bg-slate-800" />
                <StatCard title="Monthly Revenue" value={stats.revenue?.monthly || 0} icon={<BsCashStack />} color="bg-slate-800" />
                <StatCard title="Yearly Revenue" value={stats.revenue?.yearly || 0} icon={<BsCashStack />} color="bg-slate-800" />
              </div>

              {/* --- DYNAMIC REVENUE CHART --- */}
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
                    <BsGraphUpArrow className="text-blue-600" /> Revenue Growth Flow
                  </h3>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Last 7 Days</span>
                </div>
                <div className="h-[300px] w-full">
                  {stats.chartData && stats.chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                        <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `₦${v.toLocaleString()}`} />
                        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} formatter={(v) => [`₦${v.toLocaleString()}`, 'Revenue']} />
                        <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} fill="url(#colorRev)" animationDuration={1500} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full flex flex-col items-center justify-center border-2 border-dashed border-slate-50 rounded-2xl">
                      <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No Growth Data Found</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* --- AGENTS TAB --- */}
          {activeTab === 'Agents' && (
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex justify-between items-center">
                <h3 className="text-[11px] font-black uppercase tracking-widest">Registered Agent Database</h3>
                <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-[10px] font-black">{agents.length} Total</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase tracking-tighter text-slate-400 font-black">
                      <th className="px-6 py-4">Agent Profile</th>
                      <th className="px-6 py-4">Program</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {agents.map((agent) => (
                      <tr key={agent._id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <img src={agent.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover bg-slate-100" />
                            <div>
                              <p className="text-[12px] font-bold leading-tight">{agent.firstName} {agent.lastName}</p>
                              <p className="text-[10px] text-slate-400">{agent.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[11px] font-medium text-slate-500 uppercase">{agent.program}</td>
                        <td className="px-6 py-4">
                          {agent.isVerified ? 
                            <span className="text-emerald-500 flex items-center gap-1 text-[10px] font-black uppercase"><BsCheckCircleFill /> Verified</span> : 
                            <span className="text-amber-500 flex items-center gap-1 text-[10px] font-black uppercase"><BsShieldLockFill /> Pending</span>
                          }
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => handleViewAgent(agent._id)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <BsEyeFill size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

      {/* --- CHAT SUPPORT TAB --- */}
{activeTab === 'Chat Support' && (
  <div className="flex h-[calc(100vh-250px)] bg-white rounded-[2.5rem] overflow-hidden shadow-sm border border-slate-100">
    
    {/* Sidebar: ONLY Guest Support Inbox */}
    <div className="w-full md:w-80 border-r border-slate-50 flex flex-col">
      <div className="p-6 border-b border-slate-50 bg-slate-50/30">
        <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-900">Support Inbox</h3>
        <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Active Guest Inquiries</p>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {guestsOnlyThreads.map((user) => (
          <div 
            key={user._id}
            onClick={async () => {
              setActiveChat(user);
              const token = localStorage.getItem('adminToken');
              try {
                const response = await fetch(`https://zingconnect.vercel.app/api/admin/support/messages/${user._id}`, {
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                if (data.success) {
                  setActiveChat(prev => ({ ...prev, messages: data.messages }));
                  setGuests(prev => prev.map(g => g._id === user._id ? { ...g, messages: data.messages } : g));
                }
              } catch (err) {
                console.error("Critical: Failed to sync support history", err);
              }
            }}
            className={`p-4 flex items-center gap-4 cursor-pointer transition-all border-b border-slate-50/50 ${
              activeChat?._id === user._id ? 'bg-blue-50' : 'hover:bg-slate-50'
            }`}
          >
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white border border-slate-100 shadow-sm">
                <BsPeopleFill size={18} />
              </div>
              <span className="absolute -bottom-1 -right-1 w-3 h-3 border-2 border-white rounded-full bg-blue-400"></span>
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-black text-slate-800 truncate">{user.displayName}</p>
              <p className="text-[9px] text-slate-400 truncate uppercase font-bold">{user.subtitle}</p>
            </div>
          </div>
        ))}
        
        {guestsOnlyThreads.length === 0 && (
          <div className="p-10 text-center">
            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No Active Guests</p>
          </div>
        )}
      </div>
    </div>

  <div className="hidden md:flex flex-1 flex-col bg-slate-50/30">
  {activeChat ? (
    <>
      {/* Header adaptation based on User Type */}
      <div className="p-5 bg-white border-b border-slate-100 flex justify-between items-center px-8">
        <div>
          <p className="text-xs font-black text-slate-900 leading-none">
            {activeChat.isGuest ? `Anonymous Guest (${activeChat._id.slice(-4)})` : `${activeChat.firstName} ${activeChat.lastName}`}
          </p>
          <p className="text-[9px] font-bold text-blue-600 uppercase mt-1 tracking-tighter">
            {activeChat.isGuest ? 'Inbound Pricing Inquiry' : `${activeChat.program} Support Session`}
          </p>
        </div>
        {!activeChat.isGuest && (
          <button onClick={() => handleViewAgent(activeChat._id)} className="text-[9px] font-black uppercase text-slate-400 hover:text-blue-600 transition-colors">
            View Profile
          </button>
        )}
      </div>

      <div className="flex-1 p-8 overflow-y-auto space-y-6">
        {/* DYNAMIC MESSAGE HISTORY */}
        {activeChat.messages && activeChat.messages.length > 0 ? (
          activeChat.messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.isAdmin ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <div className={`p-4 rounded-[1.5rem] shadow-sm border text-[11px] font-medium leading-relaxed ${
                  msg.isAdmin 
                    ? 'bg-blue-600 text-white rounded-tr-none border-blue-700' 
                    : 'bg-white text-slate-700 rounded-tl-none border-slate-100'
                }`}>
                  {msg.text}
                </div>
                <p className={`text-[8px] mt-2 font-black uppercase tracking-tighter ${
                  msg.isAdmin ? 'text-right mr-1 text-blue-400' : 'ml-1 text-slate-400'
                }`}>
                  {msg.isAdmin ? 'System Admin' : (activeChat.isGuest ? 'Guest' : 'Agent')} • {msg.timestamp}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No conversation history</p>
          </div>
        )}
      </div>

      {/* INPUT AREA */}
      <div className="p-6 bg-white border-t border-slate-100">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleAdminReply(); }}
          className="flex gap-3 bg-slate-100 p-2 rounded-[1.5rem]"
        >
          <input 
            value={supportMessage}
            onChange={(e) => setSupportMessage(e.target.value)}
            placeholder={`Reply to ${activeChat.isGuest ? 'Guest' : activeChat.firstName}...`} 
            className="flex-1 bg-transparent border-none px-4 text-[11px] font-bold focus:ring-0"
          />
          <button 
            type="submit"
            disabled={!supportMessage.trim()}
            className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-slate-900 transition-all shadow-md"
          >
            <BsSendFill size={16} />
          </button>
        </form>
      </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
          <BsHeadset size={40} className="mb-4 opacity-10" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Select a conversation to begin support</p>
        </div>
      )}
    </div>
  </div>
)}

{activeTab === 'News Update' && (
  <div className="space-y-6">
    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
      <div className="mb-8">
        <h3 className="text-[11px] font-black uppercase tracking-widest flex items-center gap-2">
          <BsBellFill className="text-blue-600" /> Broadcast Terminal
        </h3>
        <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Send system updates or subscription alerts to agents</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LEFT: Configuration */}
        <div className="space-y-4">
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 mb-2 block">Recipient Group</label>
            <div className="flex gap-2">
              <button 
                onClick={() => setBroadcastTarget('all')}
                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${broadcastTarget === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'}`}
              >
                All Agents
              </button>
              <button 
                onClick={() => setBroadcastTarget('selected')}
                className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${broadcastTarget === 'selected' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'}`}
              >
                Selected ({selectedEmails.length})
              </button>
            </div>
          </div>

          {broadcastTarget === 'selected' && (
            <div className="h-64 overflow-y-auto border border-slate-50 rounded-2xl p-2 bg-slate-50/30">
              {agents.map(agent => (
                <label key={agent._id} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedEmails.includes(agent.email)}
                    onChange={() => toggleEmailSelection(agent.email)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                  />
                  <div>
                    <p className="text-[10px] font-bold text-slate-700">{agent.firstName} {agent.lastName}</p>
                    <p className="text-[8px] text-slate-400 font-medium">{agent.email}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Message Composer */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 mb-2 block">Announcement Subject</label>
            <input 
              type="text"
              placeholder="e.g., System Maintenance Schedule or Subscription Expiry"
              className="w-full bg-slate-50 border-none p-4 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500/20"
              value={newsSubject}
              onChange={(e) => setNewsSubject(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase text-slate-400 mb-2 block">Message Content</label>
            <textarea 
              rows="8"
              placeholder="Write your update here..."
              className="w-full bg-slate-50 border-none p-4 rounded-2xl text-xs font-medium leading-relaxed focus:ring-2 focus:ring-blue-500/20"
              value={newsContent}
              onChange={(e) => setNewsContent(e.target.value)}
            />
          </div>
          <button 
            disabled={sendingNews || !newsContent || (broadcastTarget === 'selected' && selectedEmails.length === 0)}
            onClick={handleSendBroadcast}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-blue-600/20 transition-all disabled:opacity-50"
          >
            {sendingNews ? 'Dispatching Emails...' : 'Send Broadcast Now'}
          </button>
        </div>
      </div>
    </div>
  </div>
)}

        </div>
      </main>

{/* --- AGENT DETAIL MODAL --- */}
{selectedAgent && (
  <div className="fixed inset-0 z-[100] flex items-center justify-end bg-slate-900/40 backdrop-blur-sm p-4">
    <div className="w-full max-w-md bg-white h-full rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
      <div className="p-8 flex-1 overflow-y-auto">
        <div className="flex justify-between items-start mb-8">
          <img 
            src={selectedAgent.photoUrl} 
            alt="Profile" 
            className="w-24 h-24 rounded-3xl object-cover shadow-xl border-4 border-white" 
          />
          <button 
            onClick={() => setSelectedAgent(null)} 
            className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
          >
            <BsXCircleFill size={20} className="text-slate-400" />
          </button>
        </div>
        
        <h2 className="text-2xl font-black mb-1">{selectedAgent.firstName} {selectedAgent.lastName}</h2>
        <p className="text-blue-600 text-[10px] font-black uppercase tracking-widest mb-6">
          {selectedAgent.program || 'Community Agent'}
        </p>
        
       {/* --- SUBSCRIPTION STATUS CARD --- */}
<div className="bg-slate-900 text-white p-5 rounded-[2rem] mb-6 shadow-xl shadow-slate-900/20">
  <div className="flex justify-between items-center mb-4">
    <div>
      <p className="text-[8px] font-black uppercase opacity-60 tracking-widest">Active Plan</p>
      {/* Use actual plan name from backend */}
      <p className="text-sm font-black tracking-tight">{selectedAgent.plan || 'NO ACTIVE PLAN'}</p>
    </div>
    <div className="text-right">
      <p className="text-[8px] font-black uppercase opacity-60 tracking-widest">Paid Amount</p>
      <p className="text-sm font-black">
        ₦{(selectedAgent.paymentDetails?.amountNgn || selectedAgent.subscriptionAmount || 0).toLocaleString()}
      </p>
    </div>
  </div>
  
  {/* Displaying the missing Expiry and Start dates */}
  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
    <div>
      <p className="text-[8px] font-black uppercase opacity-50 mb-1">Start Date</p>
      <p className="text-[10px] font-bold">
        {selectedAgent.subscriptionDate ? new Date(selectedAgent.subscriptionDate).toLocaleDateString() : 'N/A'}
      </p>
    </div>
    <div className="text-right">
      <p className="text-[8px] font-black uppercase opacity-50 mb-1">Expiry Date</p>
      <p className="text-[10px] font-bold text-blue-400">
        {selectedAgent.expiryDate ? new Date(selectedAgent.expiryDate).toLocaleDateString() : 'N/A'}
      </p>
    </div>
  </div>
</div>

<div className="grid grid-cols-2 gap-4 mb-8">
  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Verification</p>
    <p className={`text-xs font-bold ${selectedAgent.isVerified ? 'text-emerald-600' : 'text-amber-500'}`}>
      {selectedAgent.isVerified ? 'VERIFIED' : 'PENDING'}
    </p>
  </div>
  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">AI Voice Masking</p>
    {/* Correctly check against voicePackageActive */}
    <p className={`text-xs font-bold ${selectedAgent.voicePackageActive ? 'text-emerald-600' : 'text-slate-400'}`}>
      {selectedAgent.voicePackageActive ? 'ACTIVE' : 'INACTIVE'}
    </p>
  </div>
</div>

        {/* --- PERSONAL INFO --- */}
        <div className="space-y-4">
          <div className="border-b border-slate-50 pb-3">
            <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Email Address</p>
            <p className="text-xs font-bold lowercase">{selectedAgent.email}</p>
          </div>
          <div className="border-b border-slate-50 pb-3">
            <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Claim Program</p>
            <p className="text-xs font-bold">{selectedAgent.program || 'N/A'}</p>
          </div>
          <div className="pt-4">
            <p className="text-[8px] font-black text-slate-400 uppercase mb-2">Professional Bio</p>
            <p className="text-xs text-slate-600 leading-relaxed italic">
              "{selectedAgent.bio || 'No biography provided.'}"
            </p>
          </div>
        </div>
      </div>

      <div className="p-8 bg-slate-50 border-t border-slate-100">
        <button 
          onClick={() => handleToggleVerification(selectedAgent._id)}
          className={`w-full py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg text-white ${
            selectedAgent.isVerified ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-900 hover:bg-blue-600'
          }`}
        >
          {selectedAgent.isVerified ? 'Revoke Verification' : 'Approve Verification'}
        </button>
      </div>
    </div>
  </div>
)}


      {isSidebarOpen && <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
};

export default ZingDashboard;