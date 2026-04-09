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
        {/* We place these at the very top of the stack to ensure they match first */}
        <Route path="/agent/dashboard" element={<AgentDashboard />} />
        
        {/* Use both versions (with and without trailing slash) to be safe */}
        <Route path="/agent/profile" element={<AgentProfile />} />
        <Route path="/agent/profile/" element={<AgentProfile />} />

        {/* --- 3. PROTECTED USER ROUTES --- */}
        <Route path="/user/dashboard" element={<UserDashboard />} />

        {/* --- 4. DYNAMIC PUBLIC PROFILES --- */}
        {/* CRITICAL: This MUST stay below all /agent and /user routes. 
            If you visit /agent/profile, React Router checks the routes above first.
        */}
        <Route path="/:slug" element={<AgentSlug />} />
        
        {/* --- 5. GLOBAL FALLBACK --- */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;