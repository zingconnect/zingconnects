import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BsShieldCheck, BsCheckCircleFill, BsCopy, BsArrowLeft } from 'react-icons/bs';
import ZingConnectLogo from '../../public/logo.png';

export const VerifyOTP = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const email = location.state?.email;
  // If you passed the first name from the previous screen, get it here
  const firstName = location.state?.firstName || 'Agent'; 

  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false); // New state for resending
  const [isSuccess, setIsSuccess] = useState(false);
  const [serverSlug, setServerSlug] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!email) navigate('/pricing');
  }, [email, navigate]);

  // --- RESEND LOGIC ---
  const handleResend = async () => {
    if (isResending) return;
    setIsResending(true);

    try {
      // We hit your registration/init endpoint which you've confirmed 
      // updates existing unverified agents with a new OTP.
      const response = await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, resend: true }), // Added a flag just in case
      });

      if (response.ok) {
        alert("A new security code has been sent to your email.");
        setOtp(''); // Clear input for the new code
      } else {
        const data = await response.json();
        alert(data.message || "Failed to resend code.");
      }
    } catch (err) {
      alert("Network error. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

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
    <div className="min-h-screen bg-[#FDFDFD] text-blue-950 font-sans flex flex-col items-center">
      <header className="w-full py-10 flex justify-center px-6">
        <img src={ZingConnectLogo} alt="ZingConnect" className="h-12 md:h-16 w-auto transition-all" />
      </header>

      <main className="flex-1 w-full max-w-2xl px-6 flex flex-col justify-center items-center text-center">
        {!isSuccess ? (
          <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
            <button 
              onClick={() => navigate(-1)} 
              className="group mb-8 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-blue-600 transition-colors"
            >
              <BsArrowLeft className="group-hover:-translate-x-1 transition-transform" size={14} />
              Back to Registration
            </button>

            <div className="mb-10">
              <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mb-6 mx-auto shadow-sm">
                <BsShieldCheck size={40} />
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tighter">Verify Email</h1>
              <p className="text-[11px] md:text-[13px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-3">
                Security code sent to: <span className="text-blue-600">{email}</span>
              </p>
            </div>

            <form onSubmit={handleVerify} className="w-full max-w-sm mx-auto space-y-8">
              <div className="relative">
                <input
                  required
                  type="text"
                  maxLength="6"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="000000"
                  className="w-full text-center text-4xl md:text-5xl font-black tracking-[0.3em] py-6 bg-white border-b-4 border-gray-100 outline-none focus:border-blue-600 transition-all placeholder:text-gray-100"
                />
              </div>

              <button
                disabled={isVerifying || otp.length < 6}
                className="w-full py-5 bg-blue-600 text-white rounded-full font-black text-[12px] md:text-[14px] uppercase tracking-widest shadow-2xl hover:bg-blue-700 hover:-translate-y-1 disabled:bg-gray-200 disabled:translate-y-0 transition-all active:scale-95"
              >
                {isVerifying ? "Processing..." : "Validate Profile"}
              </button>

              <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">
                Didn't get a code?{' '}
                <span 
                  onClick={handleResend}
                  className={`text-blue-600 cursor-pointer hover:underline ${isResending ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isResending ? "Sending..." : "Resend"}
                </span>
              </p>
            </form>
          </div>
        ) : (
          /* SUCCESS STATE REMAINS SAME */
          <div className="w-full animate-in zoom-in-95 duration-700">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-green-50 text-green-500 rounded-full mb-8 shadow-inner">
              <BsCheckCircleFill size={48} />
            </div>
            <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-4">Account Ready</h2>
            <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-12">Your profile has been cryptographically verified.</p>

            <div className="w-full max-w-md mx-auto space-y-4">
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] block">Your Public Link</span>
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-white border border-gray-100 rounded-[2rem] p-3 shadow-xl">
                <div className="flex-1 px-4 py-3 text-xs md:text-sm font-bold text-blue-950 truncate bg-gray-50 rounded-2xl">
                  {fullLink}
                </div>
                <button 
                  onClick={copyToClipboard}
                  className={`px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all ${copied ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <button 
              onClick={() => navigate('/agent/dashboard')}
              className="mt-16 px-12 py-6 bg-blue-950 text-white rounded-full text-[12px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-2xl active:scale-95"
            >
              Enter Dashboard →
            </button>
          </div>
        )}
      </main>

      <footer className="w-full py-12 text-center">
        <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.5em]">
          ZingConnect Secure Protocol &copy; {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
};