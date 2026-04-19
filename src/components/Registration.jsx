import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill, BsCheckCircleFill, BsCopy, BsArrowRight, BsArrowLeft, BsShieldLockFill } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const Registration = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedPlan = location.state?.selectedPlan;

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false); // New state for OTP step
  const [isSuccess, setIsSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [otp, setOtp] = useState('');
  const [serverSlug, setServerSlug] = useState('');
  
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', address: '', occupation: '',
    program: '', bio: '', dob: '', gender: '', password: '', email: ''
  });

  useEffect(() => {
    if (!selectedPlan) navigate('/pricing');
    window.scrollTo(0, 0);
  }, [selectedPlan, navigate]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const fullLink = `${window.location.origin}/${serverSlug}`;

  // STEP 1: Initial Registration & OTP Trigger
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const data = new FormData();
      Object.keys(formData).forEach(key => data.append(key, formData[key]));
      data.append('plan', selectedPlan.tier);
      if (selectedFile) data.append('photo', selectedFile);

      const response = await fetch('/api/agents/register-init', {
        method: 'POST',
        body: data, 
      });

      const result = await response.json();

      if (response.ok) {
        setIsVerifying(true); // Move to OTP screen
        window.scrollTo(0, 0);
      } else {
        alert(`Error: ${result.message || 'Registration failed'}`);
      }
    } catch (error) {
      alert("Could not connect to the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // STEP 2: Verify OTP
  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/agents/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, otp }),
      });

      const result = await response.json();

      if (response.ok) {
        if (result.token) {
          localStorage.setItem('zingToken', result.token);
          localStorage.setItem('agentSlug', result.slug);
          setServerSlug(result.slug);
        }
        setIsSuccess(true);
        setIsVerifying(false);
      } else {
        alert(result.message || "Invalid OTP code");
      }
    } catch (error) {
      alert("Verification failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
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
          <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded">
            {selectedPlan.tier} — ${selectedPlan.price}
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        {/* VIEW 1: REGISTRATION FORM */}
        {!isVerifying && !isSuccess && (
          <div className="animate-in fade-in duration-700">
            <div className="mb-10">
              <button onClick={() => navigate('/pricing')} className="flex items-center gap-2 text-[10px] font-black text-blue-600 uppercase tracking-widest mb-6 hover:translate-x-[-4px] transition-transform">
                <BsArrowLeft /> Back to Pricing
              </button>
              <h1 className="text-2xl font-black tracking-tight mb-2">Create Agent Profile</h1>
              <p className="text-xs font-medium text-gray-500">Fill in your professional details to generate your unique live link.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* ... All your existing form fields stay here ... */}
              <div className="flex flex-col items-center md:items-start gap-4">
                <div className="relative group">
                  <div className="w-20 h-20 rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
                    {imagePreview ? <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" /> : <BsCloudUploadFill className="text-gray-300 text-xl" />}
                  </div>
                  <label className="absolute -bottom-2 -right-2 bg-blue-600 text-white p-2 rounded-lg cursor-pointer shadow-lg hover:bg-blue-700 transition-all">
                    <BsCloudUploadFill size={14} />
                    <input type="file" className="hidden" onChange={handleImageChange} accept="image/*" />
                  </label>
                </div>
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter">Profile Picture</span>
              </div>

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
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Email Address</label>
                  <input required name="email" onChange={handleInputChange} type="email" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="agent@zingconnect.com" />
                </div>
                {/* Add back all other fields from your original code here */}
              </div>

              <div className="pt-6">
                <button disabled={isSubmitting} type="submit" className="w-full md:w-auto px-10 py-4 bg-blue-600 text-white rounded-full font-black text-[11px] uppercase tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all flex items-center justify-center gap-3 disabled:bg-gray-400">
                  {isSubmitting ? "Sending Code..." : <>Confirm Registration <BsArrowRight /></>}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* VIEW 2: OTP VERIFICATION (Professional Brand Feel) */}
        {isVerifying && !isSuccess && (
          <div className="animate-in slide-in-from-bottom-4 duration-700 max-w-sm mx-auto text-center py-10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl mb-6">
              <BsShieldLockFill size={28} />
            </div>
            <h2 className="text-2xl font-black tracking-tight mb-2">Verify Your Email</h2>
            <p className="text-xs font-medium text-gray-500 mb-8">
              We've sent a 6-digit verification code to <span className="text-blue-600 font-bold">{formData.email}</span>
            </p>

            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <input 
                required 
                type="text" 
                maxLength="6"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full text-center text-3xl font-black tracking-[0.5em] py-4 border-2 border-gray-100 rounded-2xl focus:border-blue-600 outline-none transition-all"
                placeholder="000000"
              />
              <button 
                disabled={isSubmitting}
                type="submit"
                className="w-full py-4 bg-blue-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest shadow-lg hover:bg-blue-700 transition-all disabled:bg-gray-400"
              >
                {isSubmitting ? "Verifying..." : "Verify & Complete"}
              </button>
              <button 
                type="button"
                onClick={() => setIsVerifying(false)}
                className="text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-blue-600"
              >
                Change Email Address
              </button>
            </form>
          </div>
        )}

        {/* VIEW 3: SUCCESS SCREEN */}
        {isSuccess && (
          <div className="text-center py-10 animate-in zoom-in duration-1000">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-50 text-green-600 rounded-full mb-6">
              <BsCheckCircleFill size={30} />
            </div>
            <h2 className="text-3xl font-black tracking-tighter mb-4">Registration Complete</h2>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-10">Your account is now verified and active.</p>

            <div className="max-w-sm mx-auto bg-gray-50 rounded-3xl p-6 border border-gray-100 text-left">
              <span className="text-[9px] font-black text-blue-600 uppercase mb-2 block">Your Live Profile Link</span>
              <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
                <Link to={`/${serverSlug}`} className="text-xs font-bold text-blue-950 truncate mr-4 hover:text-blue-600 underline">
                  {fullLink}
                </Link>
                <button onClick={copyToClipboard} className={`flex-shrink-0 p-2 rounded-lg transition-all ${copied ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'}`}>
                  {copied ? <span className="text-[8px] font-black uppercase px-1">Copied</span> : <BsCopy size={14} />}
                </button>
              </div>
            </div>

            <button onClick={() => navigate('/')} className="mt-12 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-blue-600 transition-colors">
              ← Back to Main Page
            </button>
          </div>
        )}
      </main>

      <footer className="py-10 border-t border-gray-50 text-center">
        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">© 2026 ZingConnect</p>
      </footer>
    </div>
  );
};