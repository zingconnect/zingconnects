import { useContext } from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext'; // Import the Context object

export const ProtectedRoute = ({ requiredRole }) => {
  const auth = useContext(AuthContext); // Direct consumption
  const { isReady: isCryptoReady } = useSignal(); 
  const location = useLocation();

  // Safety check if provider is missing
  if (!auth) {
    throw new Error('ProtectedRoute must be used within an AuthProvider');
  }

  const { isAuthenticated, userRole, isLoading } = auth;

  if (isLoading || !isCryptoReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};