import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Component Imports
import { PricingPage } from './components/PricingPage';
import { Registration } from './components/Registration';
import { AgentSlug } from './components/AgentSlug';
import { AgentDashboard } from './components/AgentDashboard'; 
import { UserDashboard } from './components/UserDashboard'; 
import { AgentProfile } from './components/AgentProfile'; 

function App() {
  return (
    <Router>
      <Routes>
        {/* --- 1. PUBLIC & AUTH ROUTES --- */}
        <Route path="/" element={<PricingPage />} />
        <Route path="/Registration" element={<Registration />} />

        {/* --- 2. PROTECTED AGENT ROUTES --- */}
        <Route path="/agent/dashboard" element={<AgentDashboard />} />
        <Route path="/agent/profile" element={<AgentProfile />} />

        {/* --- 3. PROTECTED USER ROUTES --- */}
        <Route path="/user/dashboard" element={<UserDashboard />} />

        {/* --- 4. DYNAMIC PUBLIC PROFILES --- */}
        <Route path="/:slug" element={<AgentSlug />} />
        
        {/* --- 5. GLOBAL FALLBACK --- */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;