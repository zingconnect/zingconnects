import { createContext, useState, useContext, useEffect } from 'react';
import { secureFetch } from "../../api/utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    verifySession();
  }, []);

const login = async (slug) => {
  setIsLoading(true); // Lock the UI while we confirm the session
  await verifySession(); // Wait until the server confirms the cookie is valid
  setIsLoading(false);
};

  const verifySession = async () => {
    setIsLoading(true);
    try {
      // Using your central secureFetch utility
      const response = await secureFetch('/api/auth/me'); 
      
      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        setUserRole(data.role); 
      } else {
        // If the session is invalid, status will likely be 401 or 403
        setIsAuthenticated(false);
        setUserRole(null);
      }
    } catch (err) {
      console.error("Session verification failed:", err);
      setIsAuthenticated(false);
      setUserRole(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated, 
      setIsAuthenticated, 
      userRole, 
      setUserRole, 
      isLoading,
      verifySession,
      login 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);