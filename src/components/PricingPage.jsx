import React from 'react';
import { BsCheckCircleFill } from 'react-icons/bs';

// Note: Replace this with your actual logo asset location
import ZingConnectLogo from '../assets/ZingConnect_logo.svg'; 

const plans = [
  {
    tier: 'BASIC',
    term: '1 Month',
    price: '5,500',
    frequency: '/mo',
    popular: false,
    features: ['Instant Live Link', 'Unlimited User Chats', 'Real-time Dashboard'],
  },
  {
    tier: 'GROWTH',
    term: '6 Months',
    price: '13,500',
    frequency: '',
    popular: true, // Triggers "Most Popular" banner
    features: ['All Basic Features', 'Priority Message Routing', '24/7 Agent Support'],
  },
  {
    tier: 'PROFESSIONAL',
    term: '1 Year',
    price: '45,000',
    frequency: '',
    popular: false,
    features: ['All Growth Features', 'Voice Changer Access', 'Advanced Analytics'],
  },
];

const PricingCard = ({ plan }) => {
  return (
    <div className={`relative bg-white p-8 rounded-3xl border ${plan.popular ? 'border-blue-600 shadow-2xl' : 'border-gray-100 shadow-lg'} w-full max-w-sm flex flex-col`}>
      {plan.popular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-5 py-1.5 rounded-full font-bold text-xs uppercase tracking-widest z-10 shadow-md">
          Most Popular
        </div>
      )}
      <div className="flex flex-col mb-10">
        <span className="text-gray-500 font-semibold tracking-wider text-sm mb-1">{plan.tier}</span>
        <span className="text-4xl font-extrabold text-blue-950 mb-4">{plan.term}</span>
        <div className="flex items-end text-blue-950">
          <span className="text-5xl font-extrabold tracking-tight">₦{plan.price}</span>
          {plan.frequency && <span className="text-xl font-medium text-gray-600 ml-1 mb-1">{plan.frequency}</span>}
        </div>
      </div>
      <ul className="space-y-4 mb-12 flex-grow">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center text-gray-700">
            <BsCheckCircleFill className="text-green-500 text-lg mr-3" />
            <span className="font-medium text-base">{feature}</span>
          </li>
        ))}
      </ul>
      <button className={`${plan.popular ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-600'} w-full py-4 rounded-xl font-bold text-lg hover:shadow-lg transition duration-200`}>
        Start a Plan
      </button>
    </div>
  );
};

export const PricingPage = () => {
  return (
    <div className="min-h-screen bg-white">
      {/* Header section with integrated logo */}
      <header className="py-8 flex justify-center border-b border-gray-100 mb-16">
        <img src={ZingConnectLogo} alt="ZingConnect Logo" className="h-10 w-auto" />
      </header>

      <main className="container mx-auto px-6 flex flex-col items-center">
        <div className="text-center max-w-2xl mb-20">
          <h1 className="text-6xl font-extrabold text-blue-950 mb-6 leading-tight">
            Ready to Start Your <span className="text-blue-600">Live Journey?</span>
          </h1>
          <p className="text-xl text-gray-600 font-medium leading-relaxed">
            Select a plan that fits your business. Once you subscribe, your unique Agent Live Link will be generated instantly.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-10 items-stretch justify-center w-full mb-32">
          {plans.map((plan) => (
            <PricingCard key={plan.tier} plan={plan} />
          ))}
        </div>
      </main>
    </div>
  );
};