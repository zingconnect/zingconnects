import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  BsCheckCircleFill
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
  const navigate = useNavigate();

// Updated Initial Stats Fetch
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

  // Fetch Agents List when "Agents" tab is active
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

  // Fetch SINGLE Agent Details for Modal
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

  const menuItems = [
    { name: 'Dashboard', icon: <BsGrid1X2Fill /> },
    { name: 'Agents', icon: <BsPeopleFill /> },
    { name: 'Revenue', icon: <BsCashStack /> },
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
          {activeTab === 'Dashboard' && (
  <>
    {/* --- PRIMARY STATS --- */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <StatCard 
        title="Total Registered Agents" 
        value={stats.totalAgents} 
        icon={<BsPeopleFill size={24} />} 
        color="bg-blue-600" 
      />
      <StatCard 
        title="Awaiting Verification" 
        value={stats.pendingAgents} 
        icon={<BsShieldLockFill size={24} />} 
        color="bg-amber-500" 
      />
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

      {/* 
        FIX: Added a fixed height wrapper. 
        As seen in image_956197.png, ResponsiveContainer fails without a parent height.
      */}
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
              <XAxis 
                dataKey="name" 
                stroke="#94a3b8" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false} 
                dy={10}
              />
              <YAxis 
                stroke="#94a3b8" 
                fontSize={10} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={(v) => `₦${v.toLocaleString()}`} 
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                formatter={(v) => [`₦${v.toLocaleString()}`, 'Revenue']} 
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#2563eb" 
                strokeWidth={3} 
                fill="url(#colorRev)" 
                animationDuration={1500}
              />
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
        </div>
      </main>

      {/* --- AGENT DETAIL MODAL --- */}
      {selectedAgent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-end bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white h-full rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden">
            <div className="p-8 flex-1 overflow-y-auto">
              <div className="flex justify-between items-start mb-8">
                <img src={selectedAgent.photoUrl} alt="" className="w-24 h-24 rounded-3xl object-cover shadow-xl border-4 border-white" />
                <button onClick={() => setSelectedAgent(null)} className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200"><BsXCircleFill size={20} /></button>
              </div>
              
              <h2 className="text-2xl font-black mb-1">{selectedAgent.firstName} {selectedAgent.lastName}</h2>
              <p className="text-blue-600 text-[10px] font-black uppercase tracking-widest mb-6">{selectedAgent.occupation || 'Agent'}</p>
              
              {/* --- SUBSCRIPTION STATUS CARD --- */}
        <div className="bg-slate-900 text-white p-5 rounded-[2rem] mb-6 shadow-xl shadow-slate-900/20">
          <div className="flex justify-between items-center mb-4">
            <div>
              <p className="text-[8px] font-black uppercase opacity-60 tracking-widest">Active Plan</p>
              <p className="text-sm font-black tracking-tight">{selectedAgent.plan || 'BASIC'}</p>
            </div>
           <div className="text-right">
  <p className="text-[8px] font-black uppercase opacity-60 tracking-widest">Paid Amount</p>
  <p className="text-sm font-black">
    ₦{(selectedAgent.paymentDetails?.amountNgn || selectedAgent.subscriptionAmount || 0).toLocaleString()}
  </p>
</div>
          </div>
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
            <p className="text-xs font-bold">{selectedAgent.program}</p>
          </div>
          <div className="border-b border-slate-50 pb-3">
            <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Location Address</p>
            <p className="text-xs font-bold">{selectedAgent.address || 'N/A'}</p>
          </div>
          <div className="pt-4">
            <p className="text-[8px] font-black text-slate-400 uppercase mb-2">Professional Bio</p>
            <p className="text-xs text-slate-600 leading-relaxed italic">"{selectedAgent.bio || 'No biography provided.'}"</p>
          </div>
        </div>
      </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100">
              <button className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg">
                Toggle Verification Status
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