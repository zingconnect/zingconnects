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
  BsGraphUpArrow
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
    chartData: [] // For the flow chart
  });
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchStats = async () => {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        navigate('/admin-login');
        return;
      }

      try {
        const response = await fetch('https://zingconnect.vercel.app/api/admin/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
          setStats(data);
        } else {
          localStorage.removeItem('adminToken');
          navigate('/admin-login');
        }
      } catch (err) {
        console.error("Dashboard error:", err);
      }
    };
    fetchStats();
  }, [navigate]);

  const menuItems = [
    { name: 'Dashboard', icon: <BsGrid1X2Fill /> },
    { name: 'Agents', icon: <BsPeopleFill /> },
    { name: 'Revenue', icon: <BsCashStack /> },
    { name: 'Settings', icon: <BsGearFill /> },
  ];

  const StatCard = ({ title, value, icon, color, subtext }) => (
    <div className="bg-white p-4 md:p-6 rounded-[1.5rem] shadow-sm border border-slate-100 flex items-center justify-between transition-transform hover:scale-[1.02]">
      <div>
        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest mb-1">{title}</p>
        <h3 className="text-xl md:text-2xl font-black text-slate-900">
          {typeof value === 'number' && title.includes('REVENUE') ? `$${value.toLocaleString()}` : value}
        </h3>
        {subtext && <p className="text-[8px] font-bold text-slate-400 mt-1 uppercase">{subtext}</p>}
      </div>
      <div className={`${color} p-3 rounded-2xl text-white shadow-lg`}>
        {icon}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans">
      
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
          <button onClick={() => { localStorage.removeItem('adminToken'); navigate('/admin-login'); }} className="w-full py-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-400/10 transition-all">Logout Session</button>
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
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 border-2 border-white shadow-sm"><BsPersonBadgeFill size={20} /></div>
          </div>
        </header>

        <div className="p-4 md:p-8 space-y-6 overflow-y-auto">
          {activeTab === 'Dashboard' ? (
            <>
              {/* Agent Stats Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <StatCard title="Total Registered Agents" value={stats.totalAgents} icon={<BsPeopleFill size={24} />} color="bg-blue-600" />
                <StatCard title="Awaiting Verification" value={stats.pendingAgents} icon={<BsShieldLockFill size={24} />} color="bg-amber-500" />
              </div>

              {/* Revenue Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard title="Daily Revenue" value={stats.revenue?.daily || 0} icon={<BsCashStack />} color="bg-slate-800" />
                <StatCard title="Weekly Revenue" value={stats.revenue?.weekly || 0} icon={<BsCashStack />} color="bg-slate-800" />
                <StatCard title="Monthly Revenue" value={stats.revenue?.monthly || 0} icon={<BsCashStack />} color="bg-slate-800" />
                <StatCard title="Yearly Revenue" value={stats.revenue?.yearly || 0} icon={<BsCashStack />} color="bg-slate-800" />
              </div>

              {/* Revenue Flow Chart */}
              <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <BsGraphUpArrow className="text-blue-600" /> Revenue Growth Flow
                  </h3>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.chartData}>
                      <defs>
                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                      <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-64 bg-white rounded-[2rem] border border-dashed border-slate-200">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{activeTab} Section Under Construction</p>
            </div>
          )}
        </div>
      </main>

      {isSidebarOpen && <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
};

export default ZingDashboard;