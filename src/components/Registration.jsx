import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill, BsCheckCircleFill, BsCopy } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

const plans = [
  { tier: 'BASIC', term: '1 Month', price: '20', frequency: '/mo', features: ['Instant Link', 'Unlimited Chats', 'Dashboard'] },
  { tier: 'GROWTH', term: '6 Months', price: '60', frequency: '', popular: true, features: ['All Basic', 'Priority Routing', '24/7 Support'] },
  { tier: 'PROFESSIONAL', term: '1 Year', price: '125', frequency: '', features: ['All Growth', 'Voice Changer', 'Analytics'] },
];

export const Registration = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const selectedPlan = location.state?.selectedPlan;

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    address: '',
    occupation: '',
    program: '',
    bio: '',
    dob: '',
    gender: '',
    password: ''
  });

  useEffect(() => {
    if (!selectedPlan) {
      navigate('/'); 
    }
  }, [selectedPlan, navigate]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const copyToClipboard = () => {
    const link = `zingconnect.vercel.app/agent/${agentSlug}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    // --- DATABASE STORAGE LOGIC ---
    // Here you would normally use fetch or axios:
    // await fetch('/api/agents', { method: 'POST', body: JSON.stringify(formData) });
    
    console.log("Saving Agent to Database:", formData);

    // Simulate network delay
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
      window.scrollTo(0, 0);
    }, 1500);
  };

  const agentSlug = `${formData.firstName}-${formData.lastName}`.toLowerCase().replace(/\s+/g, '-');

  if (!selectedPlan) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-blue-50/20 to-white text-blue-950 font-sans overflow-x-hidden">
      <header className="py-4 md:py-6 flex justify-center border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-8 md:h-12 w-auto" />
      </header>

      <main className="container mx-auto px-4 md:px-6 py-10 max-w-7xl">
        
        {isSuccess ? (
          /* --- SUCCESS / CONGRATULATIONS SECTION --- */
          <div className="max-w-md mx-auto animate-in zoom-in-95 duration-500 text-center">
            <div className="bg-white rounded-3xl p-6 md:p-10 shadow-2xl border border-gray-100">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BsCheckCircleFill className="text-green-500 text-3xl" />
              </div>
              <h2 className="text-2xl font-black mb-2 text-blue-950">Congratulations!</h2>
              <p className="text-xs font-bold text-gray-500 mb-6 uppercase tracking-tight">Your Agent account has been created successfully.</p>
              
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-6 text-left">
                <p className="text-[10px] font-black text-blue-600 uppercase mb-1">Your Agent Live Link:</p>
                <div className="flex items-center gap-2 bg-white border border-blue-200 p-2 rounded-lg">
                  <p className="text-[11px] font-bold text-blue-900 truncate flex-grow">
                    zingconnect.live/agent/<span className="text-blue-600">{agentSlug}</span>
                  </p>
                  <button 
                    onClick={copyToClipboard}
                    className={`p-2 rounded-md transition-all ${copied ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                  >
                    {copied ? <span className="text-[8px] font-black">COPIED</span> : <BsCopy size={12} />}
                  </button>
                </div>
              </div>

              <button 
                onClick={() => navigate('/')}
                className="w-full py-3 bg-blue-950 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        ) : (
          /* --- REGISTRATION FORM SECTION --- */
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
              
              <div className="bg-blue-600 p-6 text-white flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight">Agent Registration</h2>
                  <p className="text-[10px] font-bold opacity-80">COMPLETE YOUR PROFILE TO GET STARTED</p>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] font-black opacity-60">SELECTED PLAN</span>
                  <span className="bg-white/20 px-3 py-1 rounded-full text-xs font-black">{selectedPlan.tier} - ${selectedPlan.price}</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
                <div className="md:col-span-2 flex flex-col items-center mb-4">
                  <label className="w-20 h-20 md:w-24 md:h-24 rounded-full border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition">
                    <BsCloudUploadFill className="text-blue-600 text-xl mb-1" />
                    <span className="text-[8px] font-black text-gray-400 uppercase">Upload Photo</span>
                    <input type="file" className="hidden" accept="image/*" />
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">First Name</label>
                  <input required name="firstName" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" placeholder="John" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Last Name</label>
                  <input required name="lastName" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" placeholder="Doe" />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Office / Contact Address</label>
                  <input required name="address" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" placeholder="123 Business Way, Suite 500" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Occupation</label>
                  <input required name="occupation" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" placeholder="Customer Success Manager" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Program <span className="opacity-50">(Optional)</span></label>
                  <input name="program" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" placeholder="Affiliate" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Date of Birth</label>
                  <input required name="dob" onChange={handleInputChange} type="date" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Gender</label>
                  <select required name="gender" onChange={handleInputChange} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600">
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Professional Bio</label>
                  <textarea name="bio" onChange={handleInputChange} rows="3" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" placeholder="Tell us about your professional background..."></textarea>
                </div>

                <div className="md:col-span-2 space-y-1 relative">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Password</label>
                  <input 
                    required
                    name="password"
                    onChange={handleInputChange}
                    type={showPassword ? "text" : "password"} 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs md:text-sm outline-none focus:border-blue-600" 
                    placeholder="••••••••"
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-7 text-gray-400 hover:text-blue-600"
                  >
                    {showPassword ? <BsEyeSlashFill /> : <BsEyeFill />}
                  </button>
                </div>

                <div className="md:col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-100 mt-2">
                  <p className="text-[9px] font-black text-blue-600 uppercase mb-1">Your Unique Live Link (Preview):</p>
                  <p className="text-xs font-bold text-blue-900 truncate">zingconnect.live/agent/<span className="text-blue-600">{agentSlug || 'your-name'}</span></p>
                </div>

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="md:col-span-2 mt-4 w-full py-4 bg-blue-600 text-white rounded-xl font-black text-xs md:text-sm shadow-lg hover:shadow-blue-200 transition-all disabled:opacity-50"
                >
                  {isSubmitting ? "CREATING PROFILE..." : "CONFIRM & CREATE PROFILE"}
                </button>
                
                <button 
                  type="button"
                  onClick={() => navigate('/')}
                  className="md:col-span-2 text-[10px] font-bold text-gray-400 uppercase hover:text-red-500 transition"
                >
                  Cancel Registration
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-blue-950 text-white py-12 px-6 mt-16">
        <div className="container mx-auto max-w-7xl flex flex-col md:flex-row justify-between items-center gap-6">
          <img src={ZingConnectLogo} alt="ZingConnect" className="h-6 brightness-0 invert" />
          <p className="text-[10px] font-bold text-blue-200/30 uppercase tracking-widest">© 2026 ZINGCONNECT • ALL RIGHTS RESERVED</p>
        </div>
      </footer>
    </div>
  );
};