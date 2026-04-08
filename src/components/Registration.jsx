import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsEyeFill, BsEyeSlashFill, BsCloudUploadFill } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

const plans = [
  { tier: 'BASIC', term: '1 Month', price: '20', frequency: '/mo', features: ['Instant Link', 'Unlimited Chats', 'Dashboard'] },
  { tier: 'GROWTH', term: '6 Months', price: '60', frequency: '', popular: true, features: ['All Basic', 'Priority Routing', '24/7 Support'] },
  { tier: 'PROFESSIONAL', term: '1 Year', price: '125', frequency: '', features: ['All Growth', 'Voice Changer', 'Analytics'] },
];

export const Registration = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // 1. Retrieve the plan from the navigation state sent from PricingPage
  const selectedPlan = location.state?.selectedPlan;

  const [showPassword, setShowPassword] = useState(false);
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

  // 2. Redirect back to pricing if the user tries to access this page without picking a plan
  useEffect(() => {
    if (!selectedPlan) {
      navigate('/pricing'); 
    }
  }, [selectedPlan, navigate]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const agentSlug = `${formData.firstName}-${formData.lastName}`.toLowerCase().replace(/\s+/g, '-');

  // Prevent rendering if there's no plan (handles the brief moment before redirect)
  if (!selectedPlan) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-blue-50/20 to-white text-blue-950 font-sans overflow-x-hidden">
      <header className="py-4 md:py-6 flex justify-center border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-8 md:h-12 w-auto" />
      </header>

      <main className="container mx-auto px-4 md:px-6 py-10 max-w-7xl">
        
        {!selectedPlan ? (
          /* --- PRICING SECTION --- */
          <>
            <div className="text-center max-w-3xl mx-auto mb-10">
              <h1 className="text-3xl md:text-5xl font-black mb-4">Start Your <span className="text-blue-600">Journey</span></h1>
              <p className="text-sm md:text-lg text-gray-500 font-bold">Select a plan to create your professional agent profile.</p>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-stretch justify-center w-full">
              {plans.map((plan) => (
                <div key={plan.tier} className={`relative bg-white p-6 rounded-2xl border ${plan.popular ? 'border-blue-600 shadow-xl' : 'border-gray-100 shadow-sm'} flex-1 flex flex-col`}>
                  <span className="text-[10px] font-bold text-gray-400 uppercase mb-1">{plan.tier}</span>
                  <span className="text-2xl font-black mb-4">{plan.term}</span>
                  <div className="text-3xl font-black mb-6">${plan.price}<span className="text-sm font-medium text-gray-400">{plan.frequency}</span></div>
                  <ul className="space-y-2 mb-8 flex-grow">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center text-xs font-bold text-gray-600">
                        <BsCheckCircleFill className="text-green-500 mr-2" /> {f}
                      </li>
                    ))}
                  </ul>
                  <button 
                    onClick={() => setSelectedPlan(plan)}
                    className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition"
                  >
                    Select Plan
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* --- REGISTRATION SECTION --- */
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
              
              {/* Form Header */}
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

              <form className="p-6 md:p-10 grid grid-cols-1 md:grid-cols-2 gap-5">
                
                {/* Photo Upload */}
                <div className="md:col-span-2 flex flex-col items-center mb-4">
                  <label className="w-20 h-20 md:w-24 md:h-24 rounded-full border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition">
                    <BsCloudUploadFill className="text-blue-600 text-xl mb-1" />
                    <span className="text-[8px] font-black text-gray-400">UPLOAD PHOTO</span>
                    <input type="file" className="hidden" accept="image/*" />
                  </label>
                </div>

                {/* Fields */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">First Name</label>
                  <input name="firstName" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" placeholder="John" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Last Name</label>
                  <input name="lastName" onChange={handleInputChange} type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" placeholder="Doe" />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Office / Contact Address</label>
                  <input name="address" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" placeholder="123 Business Way, Suite 500" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Occupation</label>
                  <input name="occupation" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" placeholder="Customer Success Manager" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Program <span className="opacity-50">(Optional)</span></label>
                  <input name="program" type="text" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" placeholder="Affiliate" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Date of Birth</label>
                  <input name="dob" type="date" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Gender</label>
                  <select name="gender" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600">
                    <option value="">Select Gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Professional Bio</label>
                  <textarea rows="3" className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" placeholder="Tell us about your professional background..."></textarea>
                </div>

                <div className="md:col-span-2 space-y-1 relative">
                  <label className="text-[10px] font-black text-gray-400 uppercase ml-1">Password</label>
                  <input 
                    type={showPassword ? "text" : "password"} 
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-600" 
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

                {/* Slug Preview */}
                <div className="md:col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-100 mt-2">
                  <p className="text-[9px] font-black text-blue-600 uppercase mb-1">Your Unique Live Link (Generated):</p>
                  <p className="text-xs font-bold text-blue-900 truncate">zingconnect.live/agent/<span className="text-blue-600">{agentSlug || 'your-name'}</span></p>
                </div>

                <button 
                  type="submit"
                  className="md:col-span-2 mt-4 w-full py-4 bg-blue-600 text-white rounded-xl font-black text-sm shadow-lg hover:shadow-blue-200 transition-all"
                >
                  Confirm & Create Profile
                </button>
                
                <button 
                  type="button"
                  onClick={() => setSelectedPlan(null)}
                  className="md:col-span-2 text-[10px] font-bold text-gray-400 uppercase hover:text-red-500 transition"
                >
                  Change Selected Plan
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-blue-950 text-white py-12 px-6 mt-16">
        <div className="container mx-auto max-w-7xl flex flex-col md:flex-row justify-between items-center gap-6">
          <img src={ZingConnectLogo} alt="ZingConnect" className="h-6 brightness-0 invert" />
          <p className="text-[10px] font-bold text-blue-200/30 uppercase tracking-widest">© 2026 ZINGCONNECT • ALL RIGHTS RESERVED</p>
        </div>
      </footer>
    </div>
  );
};