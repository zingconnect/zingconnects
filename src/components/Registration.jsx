import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom'; // Added Link for navigation
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill, BsCheckCircleFill, BsCopy, BsArrowRight, BsArrowLeft } from 'react-icons/bs';
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
  const [selectedFile, setSelectedFile] = useState(null);
  
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

 const getUniqueSlug = () => {
  if (!formData.firstName && !formData.lastName) return 'name';
  
  // Combine first and last name without a space first
  const combinedName = `${formData.firstName}${formData.lastName}`;
  
  return combinedName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ''); // Removes any accidental internal spaces
};

  const agentSlug = getUniqueSlug();
const fullLink = `${window.location.origin}/${agentSlug}`;
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const data = new FormData();
      
      Object.keys(formData).forEach(key => {
        data.append(key, formData[key]);
      });
      
      data.append('slug', agentSlug);
      data.append('plan', selectedPlan.tier);
      
      if (selectedFile) {
        data.append('photo', selectedFile);
      }

      const response = await fetch('/api/agents/register', {
        method: 'POST',
        body: data, 
      });

      const contentType = response.headers.get("content-type");
      
      if (contentType && contentType.includes("application/json")) {
        const result = await response.json();

        if (response.ok) {
          if (result.token) {
            localStorage.setItem('zingToken', result.token);
            localStorage.setItem('agentSlug', result.slug);
          }
          
          setIsSuccess(true);
          window.scrollTo(0, 0);
        } else {
          alert(`Registration Error: ${result.message || 'Validation failed'}`);
        }
      } else {
        const textError = await response.text();
        console.error("Server returned non-JSON response:", textError);
        alert("The server encountered an internal error. Please check backend logs.");
      }

    } catch (error) {
      console.error("Connection to backend failed:", error);
      alert("Could not connect to the server. Please check your internet connection.");
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
        {!isSuccess ? (
          <div className="animate-in fade-in duration-700">
            <div className="mb-10">
              <button 
                onClick={() => navigate('/pricing')}
                className="flex items-center gap-2 text-[10px] font-black text-blue-600 uppercase tracking-widest mb-6 hover:translate-x-[-4px] transition-transform"
              >
                <BsArrowLeft /> Back to Pricing
              </button>
              <h1 className="text-2xl font-black tracking-tight mb-2">Create Agent Profile</h1>
              <p className="text-xs font-medium text-gray-500">Fill in your professional details to generate your unique live link.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
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
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Office Address</label>
                  <input required name="address" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Suite 404, Business Ave" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Occupation</label>
                  <input required name="occupation" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Financial Advisor" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Date of Birth</label>
                  <input required name="dob" onChange={handleInputChange} type="date" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Gender</label>
                  <select required name="gender" onChange={handleInputChange} className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 bg-transparent">
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Program (Optional)</label>
                  <input name="program" onChange={handleInputChange} type="text" className="w-full border-b border-gray-200 py-2 text-sm outline-none focus:border-blue-600 transition-colors bg-transparent" placeholder="Affiliate" />
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

              <div className="p-4 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <p className="text-[9px] font-black text-blue-600 uppercase mb-1">Preview Unique Link:</p>
                <p className="text-xs font-mono text-gray-500 truncate">{fullLink}</p>
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
                      Syncing to Database...
                    </>
                  ) : (
                    <>Confirm Registration <BsArrowRight /></>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="text-center py-10 animate-in slide-in-from-bottom-8 duration-1000">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 text-blue-600 rounded-full mb-6">
              <BsCheckCircleFill size={30} />
            </div>
            <h2 className="text-3xl font-black tracking-tighter mb-4">Registration Complete</h2>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-10">Your account is now created successfully.</p>

            <div className="max-w-sm mx-auto bg-gray-50 rounded-3xl p-6 border border-gray-100 text-left">
              <span className="text-[9px] font-black text-blue-600 uppercase mb-2 block">Click to Visit Profile</span>
              <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
               <Link to={`/${agentSlug}`} className="text-xs font-bold text-blue-950 truncate mr-4 hover:text-blue-600 underline">
                {fullLink}
                </Link>
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
        <p className="text-[9px] font-bold text-gray-300 uppercase tracking-widest">© 2026 ZingConnect</p>
      </footer>
    </div>
  );
};