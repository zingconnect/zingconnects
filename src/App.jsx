import React from 'react';
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

const AgentLayoutWrapper = () => (
  <AgentCallProvider>
    <Outlet />
  </AgentCallProvider>
);

const PWAController = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isChecking, setIsChecking] = React.useState(true);

  React.useLayoutEffect(() => {
    const isStandalone = !!window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('pwa') || localStorage.getItem('agentSlug');
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
      const isDark = savedTheme === 'dark' || (savedTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', isDark);
    };
    applyTheme();
  }, []);
  return null;
};

function App() {
  return (
    <Router>
      <PWAController>
        <ThemeInitializer />
        <Routes>
          <Route path="/" element={<PricingPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/registration" element={<Registration />} />
          <Route path="/verify-otp" element={<VerifyOTP />} />
          <Route element={<AgentLayoutWrapper />}>
            <Route path="/agent/dashboard" element={<AgentDashboard />} />
            <Route path="/agent/profile" element={<AgentProfile />} />
            <Route path="/agent/call-settings" element={<CallSetting />} />
          </Route>
          <Route element={<UserCallProvider><Outlet /></UserCallProvider>}>
            <Route path="/user/dashboard" element={<UserDashboard />} />
            <Route path="/user/profile" element={<UserProfile />} />
          </Route>
          <Route path="/admin/terminal" element={<ZingAdmin />} /> 
          <Route path="/admin/dashboard" element={<ZingDashboard />} />
          <Route path="/:slug" element={<AgentSlug />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PWAController>
    </Router>
  );
}

export default App;