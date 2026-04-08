import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill, BsCheckCircleFill, BsCopy } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const Registration = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedPlan = location.state?.selectedPlan;

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '', lastName: '', address: '', occupation: '',
    program: '', bio: '', dob: '', gender: '', password: ''
  });

  useEffect(() => {
    if (!selectedPlan) navigate('/');
  }, [selectedPlan, navigate]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const agentSlug = `${formData.firstName}-${formData.lastName}`.toLowerCase().replace(/\s+/g, '-');
  const liveLink = `zingconnect.vercel.app/agent/${agentSlug || 'your-name'}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(liveLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // --- DATABASE INTEGRATION POINT ---
      // Replace the block below with your actual fetch/axios call:
      // await fetch('your-api-url/agents', { method: 'POST', body: JSON.stringify(formData) });
      
      console.log("Saving to Agent Database...", formData);
      
      // Simulating network delay
      setTimeout(() => {
        setIsSubmitting(false);
        setIsSuccess(true);
        window.scrollTo(0, 0);
      }, 1500);

    } catch (error) {
      console.error("Submission failed", error);
      setIsSubmitting(false);
    }
  };

  if (!selectedPlan) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-blue-50/20 to-white text-blue-950 font-sans">
      <header className="py-3 flex justify-center border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-7 md:h-10 w-auto" />
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {!isSuccess ? (
          /* --- REGISTRATION FORM --- */
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
              <div>
                <h2 className="text-sm font-black uppercase tracking-tight">Agent Registration</h2>
                <p className="text-[9px] font-bold opacity-80 uppercase tracking-widest">Profile Details</p>
              </div>
              <div className="text-right bg-white/10 px-2 py-1 rounded-lg border border-white/20">
                <span className="block text-[8px] font-black opacity-70 uppercase text-center">Plan</span>
                <span className="text-[10px] font-black">{selectedPlan.tier}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2 flex flex-col items-center mb-2">
                <label className="w-16 h-16 md:w-20 md:h-20 rounded-full border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition">
                  <BsCloudUploadFill className="text-blue-600 text-lg mb-1" />
                  <span className="text-[7px] font-black text-gray-400">UPLOAD</span>
                  <input type="file" className="hidden" accept="image/*" />
                </label>
              </div>

              {/* Standard Inputs */}
              {[
                { label: 'First Name', name: 'firstName', placeholder: 'John' },
                { label: 'Last Name', name: 'lastName', placeholder: 'Doe' },
                { label: 'Office Address', name: 'address', placeholder: '123 Business St', span: true },
                { label: 'Occupation', name: 'occupation', placeholder: 'Manager' },
                { label: 'Program (Optional)', name: 'program', placeholder: 'Affiliate' },
              ].map((field) => (
                <div key={field.name} className={`${field.span ? 'md:col-span-2' : ''} space-y-1`}>
                  <label className="text-[9px] font-black text-gray-400 uppercase ml-1">{field.label}</label>
                  <input required name={field.name} onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-600" placeholder={field.placeholder} />
                </div>
              ))}

              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Gender</label>
                <select name="gender" onChange={handleInputChange} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-600">
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">DOB</label>
                <input name="dob" type="date" onChange={handleInputChange} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-600" />
              </div>

              <div className="md:col-span-2 space-y-1 relative">
                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Password</label>
                <input required name="password" onChange={handleInputChange} type={showPassword ? "text" : "password"} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-600" placeholder="••••••••" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-7 text-gray-400">
                  {showPassword ? <BsEyeSlashFill size={14} /> : <BsEyeFill size={14} />}
                </button>
              </div>

              <button disabled={isSubmitting} type="submit" className="md:col-span-2 mt-4 w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs shadow-lg active:scale-95 transition-all">
                {isSubmitting ? 'CREATING ACCOUNT...' : 'CONFIRM & CREATE PROFILE'}
              </button>
            </form>
          </div>
        ) : (
          /* --- SUCCESS SCREEN --- */
          <div className="max-w-md mx-auto text-center py-10 animate-in zoom-in-95 duration-500">
            <div className="bg-white rounded-3xl p-8 shadow-2xl border border-gray-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-green-500"></div>
              
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <BsCheckCircleFill className="text-green-500 text-3xl" />
              </div>

              <h2 className="text-2xl font-black text-blue-950 mb-2">Congratulations!</h2>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-8">Your professional agent profile is now live.</p>
              
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-8">
                <p className="text-[10px] font-black text-blue-600 uppercase mb-2">Your Agent Live Link:</p>
                <div className="flex items-center gap-2 bg-white border border-blue-200 p-2 rounded-lg">
                  <p className="text-[11px] font-bold text-blue-900 truncate flex-grow text-left">{liveLink}</p>
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
                className="w-full py-3 bg-blue-950 text-white rounded-xl font-black text-xs tracking-widest uppercase hover:bg-black transition"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};