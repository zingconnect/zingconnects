import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BsPersonFill, 
  BsEnvelopeFill, 
  BsLockFill, 
  BsArrowRight, 
  BsEyeFill, 
  BsEyeSlashFill 
} from 'react-icons/bs';

const ZingAdmin = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false); // Toggle state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: ''
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const endpoint = isLogin ? '/api/admin/login' : '/api/admin/register';
    const baseUrl = 'https://zingconnect.vercel.app'; 

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success) {
        if (isLogin) {
          localStorage.setItem('adminToken', data.token);
          localStorage.setItem('adminInfo', JSON.stringify(data.admin));
          navigate('/admin/dashboard');
        } else {
          alert("Admin account created successfully!");
          setIsLogin(true);
        }
      } else {
        alert(data.message || "Authentication failed");
      }
    } catch (error) {
      console.error("Auth Error:", error);
      alert("System connection error. Check your backend.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans selection:bg-blue-500/30">
      <div className="w-full max-w-[380px] md:max-w-[400px] bg-white rounded-[2rem] md:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-500">
        
        {/* Header with Zingconnect Logo */}
        <div className="h-28 md:h-32 bg-gradient-to-br from-blue-700 to-indigo-900 w-full flex flex-col items-center justify-center text-white relative">
          <div className="bg-white p-2 md:p-3 rounded-xl md:rounded-2xl shadow-lg mb-2">
            {/* Using logo.png from your public directory */}
            <img src="/logo-s.png" alt="Zingconnect Logo" className="w-8 h-8 md:w-10 md:h-10 object-contain" />
          </div>
          <h1 className="text-lg md:text-xl font-black uppercase tracking-[0.2em]">Zing Admin</h1>
          <p className="text-[8px] md:text-[10px] font-bold opacity-60 uppercase tracking-widest text-center">
            Secure Terminal Access
          </p>
        </div>

        <div className="p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
            
            {!isLogin && (
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-2">First Name</label>
                  <div className="relative">
                    <BsPersonFill className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                    <input 
                      required
                      name="firstName"
                      onChange={handleChange}
                      placeholder="John" 
                      className="w-full bg-slate-50 border-none rounded-xl md:rounded-2xl pl-9 md:pl-10 pr-3 py-2.5 md:py-3 text-xs md:text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-2">Last Name</label>
                  <input 
                    required
                    name="lastName"
                    onChange={handleChange}
                    placeholder="Doe" 
                    className="w-full bg-slate-50 border-none rounded-xl md:rounded-2xl px-3 md:px-4 py-2.5 md:py-3 text-xs md:text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-2">Email Address</label>
              <div className="relative">
                <BsEnvelopeFill className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                <input 
                  name="email"
                  type="email"
                  required
                  onChange={handleChange}
                  placeholder="admin@zingconnect.com" 
                  className="w-full bg-slate-50 border-none rounded-xl md:rounded-2xl pl-9 md:pl-10 pr-3 py-2.5 md:py-3 text-xs md:text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] md:text-[10px] font-black uppercase text-slate-400 ml-2">Password</label>
              <div className="relative">
                <BsLockFill className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                <input 
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  onChange={handleChange}
                  placeholder="••••••••" 
                  className="w-full bg-slate-50 border-none rounded-xl md:rounded-2xl pl-9 md:pl-10 pr-10 md:pr-12 py-2.5 md:py-3 text-xs md:text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                />
                {/* Visibility Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"
                >
                  {showPassword ? <BsEyeSlashFill size={14} /> : <BsEyeFill size={14} />}
                </button>
              </div>
            </div>

            <button 
              disabled={loading}
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-black uppercase tracking-widest py-3.5 md:py-4 rounded-xl md:rounded-2xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 mt-4 md:mt-6 active:scale-[0.98] transition-all text-xs md:text-sm"
            >
              {loading ? 'Processing...' : (isLogin ? 'Enter Terminal' : 'Create Access')}
              {!loading && <BsArrowRight className="text-base md:text-lg" />}
            </button>
          </form>

          <div className="mt-6 md:mt-8 text-center">
            <button 
              onClick={() => {
                setIsLogin(!isLogin);
                setShowPassword(false); // Reset visibility when switching modes
              }}
              className="text-[8px] md:text-[10px] font-black uppercase text-slate-400 hover:text-blue-600 transition-colors tracking-widest"
            >
              {isLogin ? "Request New Administrator Access" : "Existing Administrator? Access Terminal"}
            </button>
          </div>
        </div>
      </div>

      <div className="fixed bottom-6 md:bottom-10 opacity-5 md:opacity-10 pointer-events-none text-white text-center hidden sm:block">
        <h2 className="text-2xl md:text-4xl font-black uppercase tracking-[1em]">ZingConnect</h2>
      </div>
    </div>
  );
};

export default ZingAdmin;