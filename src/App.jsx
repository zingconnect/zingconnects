import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Component Imports
import { PricingPage } from './components/PricingPage';
import { Registration } from './components/Registration';
import { AgentSlug } from './components/AgentSlug';
import { AgentDashboard } from './components/AgentDashboard'; 
import { UserDashboard } from './components/UserDashboard'; 
import { AgentProfile } from './pages/agent/AgentProfile';

function App() {
  return (
    <Router>
      <Routes>
        {/* --- 1. PUBLIC & AUTH ROUTES --- */}
        <Route path="/" element={<PricingPage />} />
        <Route path="/Registration" element={<Registration />} />

        {/* --- 2. PROTECTED AGENT ROUTES --- */}
        {/* CRITICAL: These static paths MUST come before /:slug. 
            Otherwise, React Router thinks "agent" is a slug name. 
        */}
        <Route path="/agent/dashboard" element={<AgentDashboard />} />
        <Route path="/agent/profile" element={<AgentProfile />} />
        
        {/* --- 3. PROTECTED USER ROUTES --- */}
        <Route path="/user/dashboard" element={<UserDashboard />} />

        {/* --- 4. DYNAMIC PUBLIC PROFILES --- */}
        {/* This is a "Catch-specific" route. It matches anything that 
            wasn't caught by the static routes above it.
        */}
        <Route path="/:slug" element={<AgentSlug />} />
        
        {/* --- 5. GLOBAL FALLBACK --- */}
        {/* Redirects any completely unknown URL back to home */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;