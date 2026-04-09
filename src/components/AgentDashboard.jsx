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
  BsShieldLockFill
} from 'react-icons/bs';

export const AgentDashboard = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [users, setUsers] = useState([]); 
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);

  // --- AUTH CHECK & INITIAL FETCH ---
  useEffect(() => {
    const fetchConnectedUsers = async () => {
      const token = localStorage.getItem('zingToken');
      if (!token) return navigate('/');

      try {
        const response = await fetch('/api/agents/my-users', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        setUsers(data || []);
      } catch (err) {
        console.error("Fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchConnectedUsers();
  }, [navigate]);

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
    <div className="h-screen w-screen bg-[#f0f2f5] flex overflow-hidden font-sans antialiased text-slate-900">
      
      {/* SIDEBAR */}
      <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-[30%] lg:min-w-[350px] bg-white border-r border-gray-300 flex-col z-[100]`}>
        
        {/* Sidebar Header */}
        <header className="h-[50px] md:h-[60px] bg-[#f0f2f5] px-3 flex justify-between items-center border-b border-gray-200 shrink-0 relative z-[110]">
          <div className="flex items-center relative z-[120]">
            <button 
              type="button"
              /* NUCLEAR NAVIGATION TEST */
              onClick={() => {
                console.log("FORCE REDIRECT TRIGGERED");
                alert("If you see this, the button IS clickable!");
                window.location.href = "/agent/profile"; 
              }}
              /* Added bg-red-500 temporarily so you can see the target area */
              className="h-12 w-12 rounded-full bg-red-500/10 hover:bg-red-500/20 cursor-pointer flex items-center justify-center relative z-[9999] border-2 border-red-500"
              style={{ 
                pointerEvents: 'auto',
                isolation: 'isolate'
              }}
            >
              <BsPersonCircle 
                size={34} 
                className="text-gray-600 pointer-events-none" 
              />
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

      {/* MAIN CHAT AREA */}
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
                  <h2 className="text-[12px] md:text-[14px] font-bold text-gray-800 leading-tight truncate max-w-[150px] md:max-w-none">{selectedUser.email}</h2>
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
                  className="w-full bg-white px-3 md:px-4 py-2 md:py-2.5 rounded-full text-[12px] md:text-[14px] outline-none"
                />
              </form>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 opacity-40 z-10">
            <BsShieldLockFill size={40} className="text-gray-400 mb-4" />
            <h1 className="text-lg md:text-2xl font-black text-blue-950 uppercase tracking-[0.2em] mb-2">ZingConnect</h1>
          </div>
        )}
      </main>
    </div>
  );
};