import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading, isCryptoReady } = useAuth();
  const location = useLocation();

  // DEBUG LOGGING: Use this to see exactly why you are being redirected
  // This helps identify if it's an Auth issue or a Crypto issue
  if (!isLoading) {
    console.log("🔒 ProtectedRoute Auth State:", { 
      isAuthenticated, 
      isCryptoReady, 
      userRole,
      path: location.pathname 
    });
  }

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
    console.warn("ProtectedRoute: User not authenticated. Redirecting to /");
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 3. Authenticated but Crypto failed
  if (!isCryptoReady) {
    console.error("ProtectedRoute: Crypto initialization failed. Redirecting to /");
    return <Navigate to="/" replace />;
  }

  // 4. Role-based protection
  if (requiredRole && userRole !== requiredRole) {
    console.warn(`ProtectedRoute: Access denied. Required: ${requiredRole}, Got: ${userRole}`);
    return <Navigate to="/unauthorized" replace />;
  }

  // 5. Success
  return <Outlet />;
};