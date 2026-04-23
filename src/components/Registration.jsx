import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill, BsArrowRight, BsArrowLeft } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const Registration = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedPlan = location.state?.selectedPlan;

  // --- UI & DATA STATES ---
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  
  const [formData, setFormData] = useState({
    firstName: '', 
    lastName: '', 
    email: '',
    address: '', 
    occupation: '',
    program: '', 
    bio: '', 
    dob: '', 
    gender: '', 
    password: ''
  });

  // Redirect if plan is missing and handle scroll to top
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const data = new FormData();
      
      // Append all text fields from state
      Object.keys(formData).forEach(key => {
        data.append(key, formData[key]);
      });
      
      // Append required plan metadata
      data.append('plan', selectedPlan.tier);
      
      // Append profile photo if selected
      if (selectedFile) {
        data.append('photo', selectedFile);
      }

      const response = await fetch('/api/agents/register', {
        method: 'POST',
        body: data, 
      });

      const result = await response.json();

      if (response.ok) {
        // SUCCESS: Move to the OTP page and pass the email for verification
        navigate('/verify-otp', { state: { email: formData.email } });
      } else {
        alert(`Registration Error: ${result.message || 'Validation failed'}`);
      }

    } catch (error) {
      console.error("Connection failed:", error);
      alert("Could not connect to the server. Please check your internet connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!selectedPlan) return null;

  return (
    <div className="min-h-screen bg-white text-blue-950 font-sans selection:bg-blue-100">
      <header className="py-4 px-6 flex justify-between items-center border-b border-gray-50 sticky top-0 bg-white/90 backdrop-blur-md z-50">
        <img 
          src={ZingConnectLogo} 
          alt="ZingConnect" 
          className="h-7 w-auto cursor-pointer" 
          onClick={() => navigate('/')} 
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Plan:</span>
          <span className="text-[10px] font-black bg-blue-50 text-blue-600 px-2 py-1 rounded">
            {selectedPlan.tier} — ₦{selectedPlan.price}
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-12">
        <div className="animate-in fade-in duration-700">
          <div className="mb-10">
            <button 
              onClick={() => navigate('/pricing')}
              className="flex items-center gap-2 text-[10px] font-black text-blue-600 uppercase tracking-widest mb-6 hover:translate-x-[-4px] transition-transform"
            >
              <BsArrowLeft /> Back to Pricing
            </button>
            <h1 className="text-2xl font-black tracking-tight mb-2">Create Agent Profile</h1>
            <p className="text-xs font-medium text-gray-500">
              Complete your professional details to receive your secure verification code.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* PHOTO UPLOAD SECTION */}
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

            {/* GRID FIELDS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">First Name</label>
                <input required name="firstName" value={formData.firstName} onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="John" />
              </div>
              
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Last Name</label>
                <input required name="lastName" value={formData.lastName} onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Doe" />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Email Address</label>
                <input required name="email" value={formData.email} onChange={handleInputChange} type="email" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="agent@zingconnect.com" />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Office Address</label>
                <input required name="address" value={formData.address} onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Suite 404, Business Ave" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Occupation</label>
                <input required name="occupation" value={formData.occupation} onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Financial Advisor" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Date of Birth</label>
                <input required name="dob" value={formData.dob} onChange={handleInputChange} type="date" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Gender</label>
                <select required name="gender" value={formData.gender} onChange={handleInputChange} className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent">
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Program (Optional)</label>
                <input name="program" value={formData.program} onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Affiliate" />
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Bio</label>
                <textarea name="bio" value={formData.bio} onChange={handleInputChange} rows="2" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent resize-none" placeholder="Brief professional summary..." />
              </div>

              <div className="md:col-span-2 space-y-1 relative">
                <label className="text-[10px] font-bold text-gray-400 uppercase">Secure Password</label>
                <input required name="password" value={formData.password} onChange={handleInputChange} type={showPassword ? "text" : "password"} className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-0 bottom-2 text-gray-400 hover:text-blue-600 transition-all">
                  {showPassword ? <BsEyeSlashFill size={14} /> : <BsEyeFill size={14} />}
                </button>
              </div>
            </div>

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
                  <>Confirm & Send Code <BsArrowRight /></>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>

      <footer className="py-10 border-t border-gray-50 text-center">
        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">
          © 2026 ZingConnect Protocol
        </p>
      </footer>
    </div>
  );
};