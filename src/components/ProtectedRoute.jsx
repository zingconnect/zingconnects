import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Assuming you have a LoadingSpinner component or equivalent JSX
const LoadingSpinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-white">
    <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

export const ProtectedRoute = ({ requiredRole, allowIncomplete = false }) => {
  const { 
    isAuthenticated, 
    userRole, 
    isLoading, 
    isHandshaking, 
    user 
  } = useAuth();
  
  const location = useLocation();

  // 1. Show loading spinner if still checking session or handshaking
  if (isLoading || isHandshaking) {
    return <LoadingSpinner />;
  }

  // 2. Redirect to landing if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 3. Role-based access control
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  // 4. Handle incomplete profiles 
  // Now explicitly checks if user is defined AND isProfileComplete is false
  if (!allowIncomplete && user && user.isProfileComplete === false) {
    return <Navigate to="/pricing" replace />;
  }

  return <Outlet />;
};