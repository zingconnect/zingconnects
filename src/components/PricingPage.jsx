import React from 'react';
import { BsCheckCircleFill, BsLightningChargeFill } from 'react-icons/bs';

/* Ensure your logo is in public/logo.png */
import ZingConnectLogo from '../../public/logo.png';

const plans = [
  {
    tier: 'BASIC',
    term: '1 Month',
    price: '20',
    frequency: '/mo',
    popular: false,
    features: ['Instant Live Link', 'Unlimited User Chats', 'Real-time Dashboard'],
  },
  {
    tier: 'GROWTH',
    term: '6 Months',
    price: '60',
    frequency: '',
    popular: true,
    features: ['All Basic Features', 'Priority Message Routing', '24/7 Agent Support'],
  },
  {
    tier: 'PROFESSIONAL',
    term: '1 Year',
    price: '125',
    frequency: '',
    popular: false,
    features: ['All Growth Features', 'Voice Changer Access', 'Advanced Analytics'],
  },
];

const PricingCard = ({ plan }) => (
  <div className={`relative bg-white p-6 md:p-8 rounded-3xl border ${plan.popular ? 'border-blue-600 shadow-2xl' : 'border-gray-100 shadow-lg'} flex-1 flex flex-col transition-transform hover:-translate-y-2 duration-300`}>
    {plan.popular && (
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-5 py-1.5 rounded-full font-bold text-xs uppercase tracking-widest z-10 shadow-md">
        Most Popular
      </div>
    )}
    <div className="flex flex-col mb-8">
      <span className="text-gray-500 font-semibold tracking-wider text-xs mb-1">{plan.tier}</span>
      <span className="text-3xl font-extrabold text-blue-950 mb-3">{plan.term}</span>
      <div className="flex items-end text-blue-950">
        <span className="text-4xl md:text-5xl font-extrabold tracking-tight">${plan.price}</span>
        {plan.frequency && <span className="text-lg font-medium text-gray-600 ml-1 mb-1">{plan.frequency}</span>}
      </div>
    </div>
    <ul className="space-y-3 mb-10 flex-grow">
      {plan.features.map((feature) => (
        <li key={feature} className="flex items-center text-gray-700">
          <BsCheckCircleFill className="text-green-500 text-base mr-3 shrink-0" />
          <span className="font-medium text-sm md:text-base">{feature}</span>
        </li>
      ))}
    </ul>
    <button className={`${plan.popular ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-600'} w-full py-4 rounded-xl font-bold text-lg hover:shadow-lg transition-all`}>
      Start a Plan
    </button>
  </div>
);

export const PricingPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-blue-50/30 to-white text-blue-950 font-sans">
      {/* HEADER SECTION */}
      <header className="py-6 flex justify-center border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <img src={ZingConnectLogo} alt="ZingConnect Logo" className="h-12 md:h-16 w-auto" />
      </header>

      {/* MAIN CONTENT */}
      <main className="container mx-auto px-6 pt-16 md:pt-24 max-w-7xl">
        
        {/* HERO */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-4xl md:text-6xl font-black mb-6 leading-tight">
            Ready to Start Your <span className="text-blue-600">Live Journey?</span>
          </h1>
          <p className="text-lg md:text-xl text-gray-600 font-medium leading-relaxed">
            Select a plan that fits your business. Once you subscribe, your unique Agent Live Link will be generated instantly.
          </p>
        </div>

        {/* PRICING GRID */}
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 items-stretch justify-center w-full mb-32">
          {plans.map((plan) => (
            <PricingCard key={plan.tier} plan={plan} />
          ))}
        </div>

        {/* STATS BAR */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-y border-gray-100 py-16 mb-32 text-center">
          <div>
            <p className="text-5xl font-black text-blue-600 mb-2">50k+</p>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Total Active Users</p>
          </div>
          <div>
            <p className="text-5xl font-black text-blue-600 mb-2">99.9%</p>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Server Uptime</p>
          </div>
          <div>
            <p className="text-5xl font-black text-blue-600 mb-2">24/7</p>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Instant Support</p>
          </div>
        </section>

        {/* MOCKUP SECTION */}
        <section className="pb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black mb-4 text-blue-950 uppercase">Featuring a powerful widget</h2>
            <div className="w-24 h-1.5 bg-blue-600 mx-auto rounded-full"></div>
          </div>

          <div className="flex flex-col lg:flex-row items-center justify-center gap-12 bg-blue-600 rounded-[3rem] p-8 md:p-16 overflow-hidden relative shadow-2xl">
            {/* Decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32"></div>
            
            {/* USER PHONE MOCKUP */}
            <div className="w-full max-w-[290px] bg-white rounded-[2.5rem] shadow-2xl p-4 border-[8px] border-blue-950 relative z-10">
              <div className="bg-blue-600 h-10 rounded-t-[1.5rem] -mx-4 -mt-4 mb-4 flex items-center px-4 justify-between">
                <img src={ZingConnectLogo} className="h-4 brightness-0 invert" alt="logo" />
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              </div>
              <div className="space-y-4 h-[320px] overflow-hidden">
                <div className="bg-gray-100 p-3 rounded-2xl rounded-tl-none text-[11px] font-bold w-4/5 text-gray-600">Hello! How can I help you?</div>
                <div className="bg-blue-600 text-white p-3 rounded-2xl rounded-tr-none text-[11px] font-bold w-4/5 ml-auto">I'd like to start a plan.</div>
                <div className="bg-gray-100 p-3 rounded-2xl rounded-tl-none text-[11px] font-bold w-4/5 text-gray-600">Great choice! One moment...</div>
              </div>
            </div>

            {/* LIGHTNING ICON */}
            <div className="hidden lg:block">
              <BsLightningChargeFill className="text-white text-5xl animate-pulse" />
            </div>

            {/* AGENT PHONE MOCKUP */}
            <div className="w-full max-w-[290px] bg-blue-950 rounded-[2.5rem] shadow-2xl p-4 border-[8px] border-white relative z-10">
              <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-3">
                <div className="w-6 h-6 bg-blue-600 rounded-full"></div>
                <span className="text-white font-bold text-[10px] uppercase tracking-wider">Agent Console</span>
              </div>
              <div className="space-y-4">
                <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                  <p className="text-[9px] text-blue-400 font-black mb-1">INCOMING REQUEST</p>
                  <p className="text-white text-[11px] font-bold">New user connected...</p>
                </div>
                <div className="bg-blue-600 text-white p-3 rounded-xl text-xs font-black text-center shadow-lg">JOIN CHAT</div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <div className="h-8 bg-white/5 rounded-lg border border-white/5"></div>
                  <div className="h-8 bg-white/5 rounded-lg border border-white/5"></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-blue-950 text-white py-20 px-6">
        <div className="container mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <img src={ZingConnectLogo} alt="ZingConnect" className="h-10 mb-6 brightness-0 invert" />
            <p className="text-blue-200/50 max-w-sm font-medium leading-relaxed">
              Empowering businesses with seamless, real-time communication. Join thousands of users today.
            </p>
          </div>
          <div>
            <h4 className="font-black text-xs uppercase tracking-[0.2em] text-blue-400 mb-6">Company</h4>
            <ul className="space-y-3 text-sm text-blue-200/60 font-bold">
              <li className="hover:text-white cursor-pointer transition">About Us</li>
              <li className="hover:text-white cursor-pointer transition">Careers</li>
              <li className="hover:text-white cursor-pointer transition">Privacy</li>
            </ul>
          </div>
          <div>
            <h4 className="font-black text-xs uppercase tracking-[0.2em] text-blue-400 mb-6">Support</h4>
            <ul className="space-y-3 text-sm text-blue-200/60 font-bold">
              <li className="hover:text-white cursor-pointer transition">Help Center</li>
              <li className="hover:text-white cursor-pointer transition">API</li>
              <li className="hover:text-white cursor-pointer transition">Contact</li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto max-w-7xl mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-xs font-bold text-blue-200/30">
          <p>© 2026 ZINGCONNECT. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <span>TERMS</span>
            <span>PRIVACY</span>
          </div>
        </div>
      </footer>
    </div>
  );
};