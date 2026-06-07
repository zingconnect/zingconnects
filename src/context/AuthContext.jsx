import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";
import { generateE2EEKeyPair } from '../utils/cryptoengine'; // Ensure correct path

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // NEW: Store private key in memory state
  const [privateKey, setPrivateKey] = useState(null);

  useEffect(() => {
    verifySession();
  }, []);

  // NEW: Function to generate and register keys
  const initializeCrypto = useCallback(async () => {
    const keys = await generateE2EEKeyPair();
    if (keys) {
      setPrivateKey(keys.privateKeyJwk);
      await secureFetch('/api/update-crypto-key', {
        method: 'PUT',
        body: JSON.stringify({ publicKeyJwk: keys.publicKeyJwk })
      });
      console.log("✅ E2EE Memory-session initialized.");
    }
  }, []);

  const verifySession = async () => {
    setIsLoading(true);
    try {
      const response = await secureFetch('/api/auth/me'); 
      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        setUserRole(data.role);
        // Trigger key initialization once authenticated
        await initializeCrypto();
      } else {
        setIsAuthenticated(false);
        setUserRole(null);
        setPrivateKey(null);
      }
    } catch (err) {
      setIsAuthenticated(false);
      setUserRole(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      isAuthenticated, 
      userRole, 
      isLoading,
      privateKey, // Expose key to components
      verifySession 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);