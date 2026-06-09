export const ProtectedRoute = ({ requiredRole }) => {
  const { isAuthenticated, userRole, isLoading } = useAuth();
  // If you implement the SignalProvider from the previous step:
  const { isReady: isCryptoReady } = useSignal(); 
  const location = useLocation();

  // 1. Wait for Auth AND Crypto initialization
  if (isLoading || !isCryptoReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 2. Auth checks
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  // 3. Role-based protection
  if (requiredRole && userRole !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};