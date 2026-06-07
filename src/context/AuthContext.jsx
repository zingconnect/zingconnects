import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";
import { generateE2EEKeyPair } from "../utils/cryptoEngine";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [privateKey, setPrivateKey] = useState(null);
  const [isHandshaking, setIsHandshaking] = useState(false); // Add this

  useEffect(() => {
    verifySession();
  }, []);

  const initializeCrypto = useCallback(async () => {
  setIsCryptoReady(false); // Reset while generating
  const keys = await generateE2EEKeyPair();
  if (keys) {
    setPrivateKey(keys.privateKeyJwk);
    await secureFetch('/api/update-crypto-key', {
      method: 'PUT',
      body: JSON.stringify({ publicKeyJwk: keys.publicKeyJwk })
    });
    setIsCryptoReady(true); // Signal that it's safe to encrypt
    console.log("✅ E2EE Memory-session initialized.");
  }
}, []);

const login = async (slug) => {
    setIsHandshaking(true); // Signal that we are in the middle of a process
    await verifySession();
    setIsHandshaking(false);
  };

  const verifySession = async () => {
    setIsLoading(true);
    try {
      const response = await secureFetch('/api/auth/me'); 
      if (response.ok) {
        const data = await response.json();
        console.log("Setting Auth to True"); // <--- IS THIS LOGGING?
        setIsAuthenticated(true);
        setUserRole(data.role);
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
      login,
      isLoading,
      isCryptoReady, // <--- MUST BE ADDED HERE
      privateKey, // Expose key to components
      isHandshaking, // <--- MUST BE ADDED HERE
      verifySession 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);