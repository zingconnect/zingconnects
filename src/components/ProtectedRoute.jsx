import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading, isCryptoReady, initializeCrypto } = useAuth();
  const location = useLocation();
  const [isInitializing, setIsInitializing] = useState(false);

  // 1. Handle Auto-Initialization for Crypto
  useEffect(() => {
    if (isAuthenticated && !isCryptoReady && !isInitializing) {
      setIsInitializing(true);
      initializeCrypto().finally(() => setIsInitializing(false));
    }
  }, [isAuthenticated, isCryptoReady, isInitializing, initializeCrypto]);

  // 2. Loading State
  if (isLoading || (isAuthenticated && !isCryptoReady && isInitializing)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-sm text-gray-500">Initializing Secure Session...</span>
      </div>
    );
  }

  // 3. Not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  if (!isCryptoReady) {
  return (
    <div className="text-center mt-20 p-6">
      <h2 className="text-xl font-bold mb-4">Connection Secured, but Encryption Uninitialized</h2>
      <button 
        onClick={() => window.location.reload()}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
      >
        Retry Secure Handshake
      </button>
      <p className="mt-4 text-sm text-gray-500">If this persists, please log out and back in.</p>
    </div>
  );
}

  // 5. Role-based protection
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  // 6. Success
  return <Outlet />;
};