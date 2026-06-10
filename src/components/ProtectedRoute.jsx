import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading, isCryptoReady } = useAuth();
  const location = useLocation();

  // 1. Still loading: Show the spinner
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 2. Not authenticated: Redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 3. Authenticated but Crypto failed: 
  // Redirect to home/login to force a fresh session/re-initialization
  if (!isCryptoReady) {
    console.error("ProtectedRoute: Crypto initialization failed. Redirecting to login.");
    return <Navigate to="/" replace />;
  }

  // 4. Role-based protection
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};