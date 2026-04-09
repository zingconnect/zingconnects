import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsTelephoneFill, 
  BsEmojiSmile, 
  BsPlusLg, 
  BsSendFill, 
  BsCheckAll,
  BsChevronLeft,
  BsShieldLockFill,
  BsThreeDotsVertical
} from 'react-icons/bs';

export const UserDashboard = () => {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [agent, setAgent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);

  // --- INITIAL DATA FETCH ---
  useEffect(() => {
    const fetchUserSession = async () => {
      const token = localStorage.getItem('userToken');
      if (!token) return navigate('/');

      try {
        // This endpoint returns the Agent details associated with this User's session
        const response = await fetch('/api/users/my-session', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (response.ok) {
          setAgent(data.agent); // Contains firstName, lastName, photoUrl, etc.
          // In a real app, you'd fetch message history here
          setMessages([
            {
              id: 1,
              text: `Hello! I'm ${data.agent.firstName}. How can I assist you today?`,
              sender: 'agent',
              time: '12:00 PM'
            }
          ]);
        }
      } catch (err) {
        console.error("Session fetch error:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchUserSession();
  }, [navigate]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    
    const msg = {
      id: Date.now(),
      text: newMessage,
      sender: 'user',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages([...messages, msg]);
    setNewMessage('');
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#f0f2f5] text-[10px] font-black uppercase tracking-[0.2em] text-blue-900">
      Securing Connection...
    </div>
  );

  return (
    <div className="h-screen w-screen bg-[#f0f2f5] flex flex-col overflow-hidden font-sans antialiased text-slate-900">
      
      {/* WHATSAPP HEADER */}
      <header className="h-[55px] md:h-[65px] bg-[#f0f2f5] px-3 md:px-6 flex justify-between items-center z-20 border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 md:gap-4">
          <button onClick={() => navigate(-1)} className="p-1 md:hidden text-gray-600">
            <BsChevronLeft size={20} />
          </button>
          
          <div className="relative">
            <div className="w-9 h-9 md:w-11 md:h-11 bg-white rounded-full overflow-hidden border border-gray-200 flex items-center justify-center">
              {agent?.photoUrl ? (
                <img src={agent.photoUrl} alt="Agent" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-black text-blue-600">{agent?.firstName?.[0]}</span>
              )}
            </div>
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#f0f2f5] rounded-full" />
          </div>

          <div className="flex flex-col">
            <h1 className="text-[13px] md:text-[15px] font-bold text-gray-800 leading-tight">
              {agent ? `${agent.firstName} ${agent.lastName}` : 'Verified Agent'}
            </h1>
            <p className="text-[10px] md:text-[11px] text-green-600 font-bold uppercase tracking-tighter">
              Secure Channel
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 md:gap-8 text-gray-500 pr-1">
          <BsTelephoneFill className="cursor-pointer hover:text-gray-700 transition-colors" size={16} />
          <BsThreeDotsVertical className="cursor-pointer hover:text-gray-700" size={18} />
        </div>
      </header>

      {/* CHAT BODY */}
      <main className="flex-1 relative overflow-y-auto bg-[#efeae2] p-4 md:px-[15%] lg:px-[25%] flex flex-col space-y-2 scrollbar-hide">
        {/* Authentic WhatsApp Background Pattern */}
        <div className="absolute inset-0 opacity-[0.05] pointer-events-none" 
             style={{ backgroundImage: "url('https://w0.peakpx.com/wallpaper/580/678/OH-wallpaper-whatsapp-dark-mode.jpg')" }} />

        {/* Encryption Notice */}
        <div className="self-center z-10 my-4 px-4 py-1.5 bg-[#fff9c2] rounded-lg shadow-sm border border-yellow-100 flex items-center gap-2 max-w-[90%]">
          <BsShieldLockFill size={10} className="text-gray-600" />
          <p className="text-[9px] md:text-[10px] text-gray-600 text-center font-medium leading-tight">
            Messages are end-to-end encrypted. No one outside of this chat can read them.
          </p>
        </div>

        {messages.map((m) => (
          <div 
            key={m.id} 
            className={`max-w-[85%] md:max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm relative z-10 transition-all animate-in fade-in slide-in-from-bottom-2 ${
              m.sender === 'user' 
                ? 'bg-[#dcf8c6] self-end rounded-tr-none' 
                : 'bg-white self-start rounded-tl-none'
            }`}
          >
            <p className="text-[12px] md:text-[14px] text-[#303030] leading-relaxed pr-8">{m.text}</p>
            <div className="flex items-center justify-end gap-1 mt-0.5">
              <span className="text-[8px] md:text-[9px] text-gray-400 font-medium">{m.time}</span>
              {m.sender === 'user' && <BsCheckAll size={16} className="text-blue-400" />}
            </div>
          </div>
        ))}
      </main>

      {/* FOOTER INPUT */}
      <footer className="min-h-[60px] md:min-h-[70px] bg-[#f0f2f5] px-2 md:px-6 py-3 flex items-center gap-2 md:gap-4 z-20 border-t border-gray-200">
        <div className="flex gap-3 md:gap-5 text-gray-500">
          <BsEmojiSmile className="cursor-pointer hover:text-gray-700 hidden sm:block" size={22} />
          <BsPlusLg className="cursor-pointer hover:text-gray-700" size={20} />
        </div>
        
        <form onSubmit={handleSendMessage} className="flex-1">
          <input 
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your secure message"
            className="w-full bg-white px-4 py-2.5 md:py-3 rounded-full text-[12px] md:text-[14px] outline-none shadow-sm border border-gray-100"
          />
        </form>

        <div className="w-10 md:w-12 flex justify-center items-center">
          {newMessage.trim() ? (
            <button 
              onClick={handleSendMessage} 
              className="w-10 h-10 md:w-11 md:h-11 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
            >
              <BsSendFill size={16} className="ml-0.5" />
            </button>
          ) : (
            <div className="w-10 h-10 md:w-11 md:h-11 bg-white rounded-full flex items-center justify-center text-gray-500 cursor-pointer shadow-sm hover:bg-gray-50 transition-all border border-gray-100">
               <BsTelephoneFill size={16} />
            </div>
          )}
        </div>
      </footer>
    </div>
  );
};