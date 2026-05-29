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
import ZingAdmin from './components/ZingAdmin'; 
import ZingDashboard from './components/ZingDashboard'; 

// Context Providers
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

    // 1. Identify if we are at a "default" landing state
    const isAtRoot = location.pathname === '/' || location.pathname === '/pricing' || location.pathname === '/registration';
    
    // 2. Define routes we SHOULD NOT interrupt
    // If the URL is already something specific, don't redirect to the "target"
    const isAlreadyDeepLinked = location.pathname.split('/').length > 2 || 
                               (location.pathname !== '/' && location.pathname !== '/pricing');

    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get('pwa');
    const storageSlug = localStorage.getItem('agentSlug');
    const target = urlSlug || storageSlug;

    // 3. Only redirect if we are standalone, at root, have a target, 
    // AND are not already navigating somewhere specific
    if (isStandalone && isAtRoot && target && !isAlreadyDeepLinked) {
      navigate(`/${target}`, { replace: true });
    } else {
      setIsChecking(false);
    }
  }, [navigate, location.pathname]);

  // Only show the loading screen if we are actually doing the check
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

const RootGate = () => {
  const slug = localStorage.getItem('agentSlug');
  return slug ? <Navigate to={`/${slug}`} replace /> : <PricingPage />;
};

function App() {
  return (
    <Router>
      <PWAController>
        <ThemeInitializer />
        <Routes>
          {/* --- 1. UPDATED PUBLIC ROUTE --- */}
          {/* Replace your old path="/" with the RootGate */}
          <Route path="/" element={<RootGate />} />
          
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/registration" element={<Registration />} />
          <Route path="/verify-otp" element={<VerifyOTP />} />

          {/* --- 2. PROTECTED AGENT ROUTES --- */}
          <Route element={<AgentLayoutWrapper />}>
            <Route path="/agent/dashboard" element={<AgentDashboard />} />
            <Route path="/agent/profile" element={<AgentProfile />} />
            <Route path="/agent/call-settings" element={<CallSetting />} />
          </Route>

          {/* --- 3. PROTECTED USER ROUTES --- */}
          <Route element={<UserCallProvider><Outlet /></UserCallProvider>}>
            <Route path="/user/dashboard" element={<UserDashboard />} />
            <Route path="/user/profile" element={<UserProfile />} />
          </Route>

          {/* --- 4. ADMINISTRATOR ROUTES --- */}
          <Route path="/admin/terminal" element={<ZingAdmin />} /> 
          <Route path="/admin/dashboard" element={<ZingDashboard />} />
          
          {/* --- 5. DYNAMIC PUBLIC PROFILES --- */}
          <Route path="/:slug" element={<AgentSlug />} />
          
          {/* --- 6. GLOBAL FALLBACK --- */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PWAController>
    </Router>
  );
}

export default App;