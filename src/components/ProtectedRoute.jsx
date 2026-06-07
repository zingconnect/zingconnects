import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading, isSubscribed } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 1. Redirect if not logged in
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 2. Role validation (e.g., if you try to access an agent-only route)
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  // 3. Subscription validation
  // Only enforce subscription if the user is an AGENT. 
  // 'Handshake Users' bypass this check because they aren't required to subscribe.
  if (userRole === 'agent' && !isSubscribed) {
    return <Navigate to="/pricing" replace />;
  }

  return <Outlet />;
};