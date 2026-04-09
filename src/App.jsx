import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Component Imports
import { PricingPage } from './components/PricingPage';
import { Registration } from './components/Registration';
import { AgentSlug } from './components/AgentSlug';
import { AgentDashboard } from './components/AgentDashboard'; 
import { UserDashboard } from './components/UserDashboard'; 
import { AgentProfile } from './pages/agent/AgentProfile'; // or your correct path

function App() {
  return (
    <Router>
      <Routes>
        {/* 1. Public Marketing & Signup */}
        <Route path="/" element={<PricingPage />} />
        <Route path="/Registration" element={<Registration />} />

        {/* 2. Professional Portals (WhatsApp-style CRM) */}
        {/* These must stay above the dynamic :slug route */}
        <Route path="/agent/dashboard" element={<AgentDashboard />} />
        <Route path="/user/dashboard" element={<UserDashboard />} />

        {/* 3. Dynamic Public Profiles */}
        {/* Captured via :slug (e.g., zingconnect.com/john-doe). 
            This is where users perform the "handshake".
        */}
        <Route path="/:slug" element={<AgentSlug />} />

        <Route path="/agent/profile" element={<AgentProfile />} />
        
        {/* 4. Catch-all / 404 Redirect */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;