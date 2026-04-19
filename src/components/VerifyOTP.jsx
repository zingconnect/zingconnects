import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsShieldCheck, BsArrowLeft, BsCheckCircleFill, BsCopy } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const VerifyOTP = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const email = location.state?.email; // Get email passed from Registration

  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [serverSlug, setServerSlug] = useState('');
  const [copied, setCopied] = useState(false);

  // Security: If no email is present, they shouldn't be here
  useEffect(() => {
    if (!email) navigate('/pricing');
  }, [email, navigate]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setIsVerifying(true);

    try {
      const response = await fetch('/api/agents/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      const data = await response.json();

      if (response.ok) {
        setServerSlug(data.slug);
        // Store token so they are logged in immediately
        localStorage.setItem('zingToken', data.token);
        localStorage.setItem('agentSlug', data.slug);
        setIsSuccess(true);
      } else {
        alert(data.message || "Invalid Code");
      }
    } catch (err) {
      alert("Connection error. Try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const fullLink = `${window.location.origin}/${serverSlug}`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 font-sans flex flex-col">
      <header className="py-6 px-10">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-7 w-auto" />
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        {!isSuccess ? (
          <div className="w-full max-w-md bg-white p-8 md:p-12 rounded-[3rem] shadow-xl border border-gray-50 animate-in fade-in zoom-in duration-500">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <BsShieldCheck size={32} />
              </div>
              <h1 className="text-2xl font-black tracking-tight">Verify Email</h1>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2">
                Sent to: <span className="text-blue-600">{email}</span>
              </p>
            </div>

            <form onSubmit={handleVerify} className="space-y-6">
              <div>
                <input
                  required
                  type="text"
                  maxLength="6"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter 6-digit code"
                  className="w-full text-center text-2xl font-black tracking-[0.5em] py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] outline-none focus:border-blue-600 focus:bg-white transition-all"
                />
              </div>

              <button
                disabled={isVerifying || otp.length < 6}
                className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-lg hover:bg-blue-700 disabled:bg-gray-200 transition-all"
              >
                {isVerifying ? "Verifying..." : "Validate Profile"}
              </button>

              <p className="text-[10px] text-center text-gray-400 font-bold">
                Didn't get a code? Check your spam folder.
              </p>
            </form>
          </div>
        ) : (
          /* SUCCESS SCREEN MOVED HERE */
          <div className="text-center py-10 animate-in slide-in-from-bottom-8 duration-1000">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-50 text-green-500 rounded-full mb-6">
              <BsCheckCircleFill size={40} />
            </div>
            <h2 className="text-3xl font-black tracking-tighter mb-4">Profile Activated</h2>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-10">Your encrypted live link is ready.</p>

            <div className="max-w-sm mx-auto bg-white rounded-3xl p-8 border border-gray-100 shadow-2xl text-left">
              <span className="text-[9px] font-black text-blue-600 uppercase mb-3 block tracking-widest">Your Public Channel</span>
              <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-2xl p-4">
                <span className="text-xs font-bold text-blue-950 truncate mr-4">
                  {fullLink}
                </span>
                <button 
                  onClick={copyToClipboard}
                  className={`flex-shrink-0 p-3 rounded-xl transition-all ${copied ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'}`}
                >
                  {copied ? <span className="text-[8px] font-black uppercase">Copied</span> : <BsCopy size={16} />}
                </button>
              </div>
            </div>

            <button 
              onClick={() => navigate('/agent/dashboard')}
              className="mt-12 px-8 py-4 bg-blue-950 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl"
            >
              Go to Agent Dashboard →
            </button>
          </div>
        )}
      </main>

      <footer className="py-10 text-center opacity-30">
        <p className="text-[8px] font-black uppercase tracking-[0.3em]">ZingConnect Secure Protocol</p>
      </footer>
    </div>
  );
};