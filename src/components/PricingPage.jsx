import React from 'react';
import { useNavigate } from 'react-router-dom';
// Added BsLightningChargeFill to the import list below
import { BsCheckCircleFill, BsLightningChargeFill } from 'react-icons/bs'; 
import ZingConnectLogo from '../../public/logo.png';

const plans = [
  {
    tier: 'BASIC',
    term: '1 Month',
    price: '20',
    frequency: '/mo',
    popular: false,
    features: ['Instant Link', 'Unlimited Chats', 'Dashboard'],
  },
  {
    tier: 'GROWTH',
    term: '6 Months',
    price: '60',
    frequency: '',
    popular: true,
    features: ['All Basic', 'Priority Routing', '24/7 Support'],
  },
  {
    tier: 'PROFESSIONAL',
    term: '1 Year',
    price: '125',
    frequency: '',
    popular: false,
    features: ['All Growth', 'Voice Changer', 'Analytics'],
  },
];

const PricingCard = ({ plan }) => {
  const navigate = useNavigate();

  const handleSelectPlan = () => {
    navigate('/Registration', { state: { selectedPlan: plan } });
  };

  return (
    <div className={`relative bg-white p-5 md:p-8 rounded-2xl border ${plan.popular ? 'border-blue-600 shadow-xl' : 'border-gray-100 shadow-md'} flex-1 flex flex-col transition-transform hover:-translate-y-1 duration-300`}>
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-1 rounded-full font-bold text-[10px] uppercase tracking-widest z-10 shadow-sm">
          Most Popular
        </div>
      )}
      <div className="flex flex-col mb-4 md:mb-8">
        <span className="text-gray-400 font-bold tracking-wider text-[10px] mb-1">{plan.tier}</span>
        <span className="text-2xl md:text-3xl font-extrabold text-blue-950 mb-2">{plan.term}</span>
        <div className="flex items-end text-blue-950">
          <span className="text-3xl md:text-5xl font-black tracking-tight">${plan.price}</span>
          {plan.frequency && <span className="text-sm md:text-lg font-medium text-gray-500 ml-1 mb-1">{plan.frequency}</span>}
        </div>
      </div>
      <ul className="space-y-2 md:space-y-3 mb-6 md:mb-10 flex-grow">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center text-gray-600">
            <BsCheckCircleFill className="text-green-500 text-sm md:text-base mr-2 shrink-0" />
            <span className="font-semibold text-xs md:text-base">{feature}</span>
          </li>
        ))}
      </ul>
      <button 
        onClick={handleSelectPlan}
        className={`${plan.popular ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-600'} w-full py-3 md:py-4 rounded-xl font-bold text-sm md:text-lg transition-all`}
      >
        Start Plan
      </button>
    </div>
  );
};

export const PricingPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-blue-50/20 to-white text-blue-950 font-sans overflow-x-hidden">
      <header className="py-4 md:py-6 flex justify-center border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <img src={ZingConnectLogo} alt="ZingConnect Logo" className="h-8 md:h-16 w-auto" />
      </header>

      <main className="container mx-auto px-4 md:px-6 pt-10 md:pt-24 max-w-7xl">
        <div className="text-center max-w-3xl mx-auto mb-10 md:mb-16">
          <h1 className="text-3xl md:text-6xl font-black mb-4 md:mb-6 leading-tight px-2">
            Start Your <span className="text-blue-600">Live Journey</span>
          </h1>
          <p className="text-sm md:text-xl text-gray-500 font-bold leading-relaxed px-4">
            Select a plan that fits your business. Agent Live Links are generated instantly.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-4 lg:gap-10 items-stretch justify-center w-full mb-16 md:mb-32">
          {plans.map((plan) => (
            <PricingCard key={plan.tier} plan={plan} />
          ))}
        </div>

        <section className="grid grid-cols-3 gap-2 border-y border-gray-100 py-8 md:py-16 mb-16 md:mb-32 text-center">
          <div>
            <p className="text-xl md:text-5xl font-black text-blue-600 mb-1">50k+</p>
            <p className="text-gray-400 font-bold uppercase tracking-tighter text-[8px] md:text-xs">Active Users</p>
          </div>
          <div>
            <p className="text-xl md:text-5xl font-black text-blue-600 mb-1">99.9%</p>
            <p className="text-gray-400 font-bold uppercase tracking-tighter text-[8px] md:text-xs">Uptime</p>
          </div>
          <div>
            <p className="text-xl md:text-5xl font-black text-blue-600 mb-1">24/7</p>
            <p className="text-gray-400 font-bold uppercase tracking-tighter text-[8px] md:text-xs">Support</p>
          </div>
        </section>

        <section className="pb-16 md:pb-32 px-2">
          <div className="text-center mb-8 md:mb-16">
            <h2 className="text-xl md:text-5xl font-black mb-2 text-blue-950 uppercase tracking-tight">Powerful Widget</h2>
            <div className="w-12 h-1 bg-blue-600 mx-auto rounded-full"></div>
          </div>

          <div className="flex flex-col lg:flex-row items-center justify-center gap-6 md:gap-12 bg-blue-600 rounded-[2rem] md:rounded-[3rem] p-6 md:p-16 overflow-hidden relative shadow-xl">
            <div className="absolute top-0 right-0 w-32 h-32 md:w-64 md:h-64 bg-white/10 rounded-full -mr-16 -mt-16"></div>
            
            <div className="w-full max-w-[240px] md:max-w-[290px] bg-white rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl p-3 border-[6px] border-blue-950 relative z-10">
              <div className="bg-blue-600 h-8 rounded-t-[1rem] -mx-3 -mt-3 mb-3 flex items-center px-3 justify-between">
                <img src={ZingConnectLogo} className="h-3 brightness-0 invert" alt="logo" />
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full"></div>
              </div>
              <div className="space-y-3 h-[200px] md:h-[320px] overflow-hidden">
                <div className="bg-gray-100 p-2 rounded-xl rounded-tl-none text-[9px] md:text-[11px] font-bold text-gray-600">Hi! How can I help?</div>
                <div className="bg-blue-600 text-white p-2 rounded-xl rounded-tr-none text-[9px] md:text-[11px] font-bold w-4/5 ml-auto text-right">I'd like to start.</div>
              </div>
            </div>

            <div className="hidden lg:block">
              <BsLightningChargeFill className="text-white text-5xl animate-pulse" />
            </div>

            <div className="w-full max-w-[240px] md:max-w-[290px] bg-blue-950 rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl p-3 border-[6px] border-white relative z-10">
              <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-2">
                <div className="w-5 h-5 bg-blue-600 rounded-full"></div>
                <span className="text-white font-bold text-[8px] uppercase">Console</span>
              </div>
              <div className="space-y-3">
                <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                  <p className="text-[10px] text-white font-bold leading-tight text-center">New User Online</p>
                </div>
                <div className="bg-blue-600 text-white py-2 rounded-lg text-[10px] font-black text-center shadow-lg uppercase">Join</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-blue-950 text-white py-12 md:py-20 px-6">
        <div className="container mx-auto max-w-7xl grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-2">
            <img src={ZingConnectLogo} alt="ZingConnect" className="h-6 md:h-10 mb-4 brightness-0 invert" />
            <p className="text-blue-200/50 max-w-sm font-semibold text-xs md:text-sm">
              Real-time communication for modern teams.
            </p>
          </div>
          <div>
            <h4 className="font-black text-[10px] uppercase tracking-widest text-blue-400 mb-4">Links</h4>
            <ul className="space-y-2 text-[10px] md:text-sm text-blue-200/60 font-bold">
              <li>Features</li>
              <li>Pricing</li>
            </ul>
          </div>
          <div>
            <h4 className="font-black text-[10px] uppercase tracking-widest text-blue-400 mb-4">Help</h4>
            <ul className="space-y-2 text-[10px] md:text-sm text-blue-200/60 font-bold">
              <li>Center</li>
              <li>Contact</li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto max-w-7xl mt-12 pt-6 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-[8px] md:text-xs font-bold text-blue-200/30">
          <p>© 2026 ZINGCONNECT</p>
          <p className="mt-2 md:mt-0">PRIVACY • TERMS</p>
        </div>
      </footer>
    </div>
  );
};