import React, { useLayoutEffect } from 'react'; 
// Imported 'Outlet' so the layout can render child components
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation, Outlet } from 'react-router-dom';

// Component Imports
import { PricingPage } from './components/PricingPage';
import { Registration } from './components/Registration';
import { VerifyOTP } from './components/VerifyOTP'; 
import { AgentSlug } from './components/AgentSlug';
import { AgentDashboard } from './components/AgentDashboard'; 
import { UserDashboard } from './components/UserDashboard'; 
import { AgentProfile } from './components/AgentProfile'; 
import { UserProfile } from './components/UserProfile'; 
import { CallSetting } from './components/CallSetting'; 
import { ProtectedRoute } from './components/ProtectedRoute';
import ZingAdmin from './components/ZingAdmin'; 
import ZingDashboard from './components/ZingDashboard'; 


import { AuthProvider } from './context/AuthContext'; // NEW
import { UserCallProvider } from './context/UserCallContext';
import { AgentCallProvider } from './context/AgentCallContext';

const AgentLayoutWrapper = () => {
  return (
    <AgentCallProvider>
      {/* Renders your child components inside the context lifecycle */}
      <Outlet />
    </AgentCallProvider>
  );
};

const PWAController = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isChecking, setIsChecking] = React.useState(true);

  React.useLayoutEffect(() => {
    const isStandalone = !!window.navigator.standalone || 
                         window.matchMedia('(display-mode: standalone)').matches;

    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get('pwa');
    const storageSlug = localStorage.getItem('agentSlug');
    const target = urlSlug || storageSlug;

    const isAtRoot = location.pathname === '/' || location.pathname === '/pricing';

    if (isStandalone && isAtRoot && target) {
      navigate(`/${target}`, { replace: true });
    } else {
      setIsChecking(false);
    }
  }, [navigate, location.pathname]);

  if (isChecking && (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches)) {
    return <div className="min-h-screen bg-white" />; 
  }

  return children;
};

const ThemeInitializer = () => {
  React.useLayoutEffect(() => {
    const applyTheme = () => {
      const savedTheme = localStorage.getItem('theme') || 'system';
      const root = window.document.documentElement;
      
      const isDark = 
        savedTheme === 'dark' || 
        (savedTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme();
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (localStorage.getItem('theme') === 'system') applyTheme();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return null;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <PWAController>
          <ThemeInitializer />
          <Routes>
            {/* --- 1. PUBLIC & AUTH ROUTES --- */}
            <Route path="/" element={<PricingPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/registration" element={<Registration />} />
            <Route path="/verify-otp" element={<VerifyOTP />} />
            <Route path="/:slug" element={<AgentSlug />} />

            {/* --- 2. PROTECTED ROUTES (Requires Token) --- */}
            <Route element={<ProtectedRoute />}>
              {/* Agent Routes */}
              <Route element={<AgentLayoutWrapper />}>
                <Route path="/agent/dashboard/:slug" element={<AgentDashboard />} />
                <Route path="/agent/profile/:slug" element={<AgentProfile />} />
                <Route path="/agent/call-settings/:slug" element={<CallSetting />} />
              </Route>

              {/* User Routes */}
              <Route element={<UserCallProvider><Outlet /></UserCallProvider>}>
                <Route path="/user/dashboard/:agentId" element={<UserDashboard />} />
                <Route path="/user/profile/:agentId" element={<UserProfile />} />
              </Route>
            </Route>

            {/* --- 3. ADMINISTRATOR ROUTES --- */}
            <Route path="/admin/terminal" element={<ZingAdmin />} /> 
            <Route path="/admin/dashboard" element={<ZingDashboard />} />
            
            {/* --- 4. GLOBAL FALLBACK --- */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </PWAController>
      </Router>
    </AuthProvider>
  );
}

export default App;