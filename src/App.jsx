import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PricingPage } from './components/PricingPage';
import { Registration } from './components/Registration';

function App() {
  return (
    <Router>
      <Routes>
        {/* Step 1: Landing/Pricing */}
        <Route path="/" element={<PricingPage />} />
        
        {/* Step 2: Registration */}
        <Route path="/Registration" element={<Registration />} />

        {/* Redirect any random URL back to pricing */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;