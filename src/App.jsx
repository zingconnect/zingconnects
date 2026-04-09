import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PricingPage } from './components/PricingPage';
import { Registration } from './components/Registration';
import { AgentSlug } from './components/AgentSlug'; // Import the Profile Component

function App() {
  return (
    <Router>
      <Routes>
        {/* Step 1: Landing/Pricing */}
        <Route path="/" element={<PricingPage />} />
        
        {/* Step 2: Registration Form */}
        <Route path="/Registration" element={<Registration />} />

        {/* Step 3: Dynamic Agent Profile Page */}
        {/* The ':slug' acts as a variable to capture the unique name from the URL */}
        <Route path="/:slug" element={<AgentSlug />} />
        
        {/* Catch-all: Redirect any random URL back to pricing */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;