import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  // Ensure you include isHandshaking in your destructuring
  const { isAuthenticated, userRole, isLoading, isHandshaking } = useAuth();
  const location = useLocation();

  // If the system is still checking the session OR handshaking, wait.
  if (isLoading || isHandshaking) {
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