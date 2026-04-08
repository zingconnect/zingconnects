import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill, BsCheckCircleFill, BsCopy, BsArrowRight } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const Registration = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedPlan = location.state?.selectedPlan;

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', address: '', occupation: '',
    program: '', bio: '', dob: '', gender: '', password: ''
  });

  useEffect(() => {
    if (!selectedPlan) navigate('/');
    window.scrollTo(0, 0);
  }, [selectedPlan, navigate]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const agentSlug = `${formData.firstName}-${formData.lastName}`.toLowerCase().replace(/\s+/g, '-');
  const fullLink = `zingconnect.vercel.app/agent/${agentSlug || 'name'}`;

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Strict 3-second delay as requested
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
      window.scrollTo(0, 0);
    }, 3000);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!selectedPlan) return null;

  return (
    <div className="min-h-screen bg-white text-blue-950 font-sans selection:bg-blue-100">
      <header className="py-4 px-6 flex justify-between items-center border-b border-gray-50 sticky top-0 bg-white/90 backdrop-blur-md z-50">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-7 w-auto" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Plan:</span>
          <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded">{selectedPlan.tier}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {!isSuccess ? (
          <div className="animate-in fade-in duration-700">
            {/* Minimal Header */}
            <div className="mb-10 text-center md:text-left">
              <h1 className="text-2xl font-black tracking-tight mb-2">Create Agent Profile</h1>
              <p className="text-xs font-medium text-gray-500">Fill in your professional details to generate your live link.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Profile Image Preview Section */}
              <div className="flex flex-col items-center md:items-start gap-4">
                <div className="relative group">
                  <div className="w-20 h-20 rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <BsCloudUploadFill className="text-gray-300 text-xl" />
                    )}
                  </div>
                  <label className="absolute -bottom-2 -right-2 bg-blue-600 text-white p-2 rounded-lg cursor-pointer shadow-lg hover:bg-blue-700 transition-all">
                    <BsCloudUploadFill size={14} />
                    <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" />
                  </label>
                </div>
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter">Profile Picture</span>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">First Name</label>
                  <input required name="firstName" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="John" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Last Name</label>
                  <input required name="lastName" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Doe" />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Office Address</label>
                  <input required name="address" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Suite 404, Business Ave" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Occupation</label>
                  <input required name="occupation" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Financial Advisor" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Gender</label>
                  <select required name="gender" onChange={handleInputChange} className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent">
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Bio</label>
                  <textarea name="bio" onChange={handleInputChange} rows="2" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent resize-none" placeholder="Brief professional summary..." />
                </div>
                <div className="md:col-span-2 space-y-1 relative">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Secure Password</label>
                  <input required name="password" onChange={handleInputChange} type={showPassword ? "text" : "password"} className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-0 bottom-2 text-gray-400">
                    {showPassword ? <BsEyeSlashFill size={14} /> : <BsEyeFill size={14} />}
                  </button>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-6">
                <button 
                  disabled={isSubmitting}
                  type="submit"
                  className="w-full md:w-auto px-10 py-4 bg-blue-600 text-white rounded-full font-black text-[11px] uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all flex items-center justify-center gap-3 disabled:bg-gray-400"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>Confirm Registration <BsArrowRight /></>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* --- SUCCESS STATE (Professional & Compact) --- */
          <div className="text-center py-10 animate-in slide-in-from-bottom-8 duration-1000">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 text-blue-600 rounded-full mb-6">
              <BsCheckCircleFill size={30} />
            </div>
            <h2 className="text-3xl font-black tracking-tighter mb-4">You're all set!</h2>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-10">Your account and live link are now active.</p>

            <div className="max-w-sm mx-auto bg-gray-50 rounded-3xl p-6 border border-gray-100 text-left">
              <span className="text-[9px] font-black text-blue-600 uppercase mb-2 block">Generated Live Link</span>
              <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
                <span className="text-xs font-bold text-blue-950 truncate mr-4">{fullLink}</span>
                <button 
                  onClick={copyToClipboard}
                  className={`flex-shrink-0 p-2 rounded-lg transition-all ${copied ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'}`}
                >
                  {copied ? <span className="text-[8px] font-black uppercase px-1">Copied</span> : <BsCopy size={14} />}
                </button>
              </div>
            </div>

            <button 
              onClick={() => navigate('/')}
              className="mt-12 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-blue-600 transition-colors"
            >
              ← Back to Main Page
            </button>
          </div>
        )}
      </main>

      <footer className="py-10 border-t border-gray-50 text-center">
        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">© 2026 ZingConnect International</p>
      </footer>
    </div>
  );
};