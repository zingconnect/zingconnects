import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null); // 'user' or 'agent'
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    verifySession();
  }, []);

  const verifySession = async () => {
    setIsLoading(true);
    try {
      // Your backend should return the role in the response
      const response = await fetch('/api/auth/me'); 
      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        setUserRole(data.role); 
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated, userRole, setUserRole, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);