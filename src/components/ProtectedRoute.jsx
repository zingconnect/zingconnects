import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div>Authenticating...</div>;
  }

  // 1. Redirect if not logged in
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 2. Optional: Role-based protection
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};