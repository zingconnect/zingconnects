import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading, isCryptoReady } = useAuth();
  const location = useLocation();

  // 1. Only show spinner if the app is still determining auth status
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 2. If NOT authenticated, redirect immediately (Don't wait for Crypto!)
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 3. If authenticated but Crypto isn't ready, you can show a smaller 
  // "Initializing Security..." message instead of a permanent wall
  if (!isCryptoReady) {
    return <div>Initializing secure connection...</div>; 
  }

  // 4. Role-based protection
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};