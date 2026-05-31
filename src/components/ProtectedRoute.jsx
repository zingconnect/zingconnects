import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = () => {
  const { token, isLoading } = useAuth();
  const location = useLocation();

  // If we are still loading the Auth state, show a loader
  if (isLoading) {
    return <div>Authenticating...</div>;
  }

  // If no token, redirect to /pricing, but pass the current path as state
  if (!token) {
    return (
      <Navigate 
        to="/pricing" 
        state={{ from: location.pathname + location.search }} 
        replace 
      />
    );
  }

  return <Outlet />;
};