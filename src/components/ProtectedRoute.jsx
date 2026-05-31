import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = () => {
  const { token } = useAuth();

  // If there is no token, redirect immediately to /pricing
  if (!token) {
    return <Navigate to="/pricing" replace />;
  }

  // Otherwise, render the child route (Outlet)
  return <Outlet />;
};