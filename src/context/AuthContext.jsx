import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";
import { generateIdentityKeyPair } from "../utils/cryptoEngine";
import { savePrivateKey, getPrivateKey, clearKeys } from "../utils/cryptoStorage"; 


const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [privateKey, setPrivateKey] = useState(null);
  const [isHandshaking, setIsHandshaking] = useState(false);

  // 1. Initial Load: Try to hydrate keys from IndexedDB
  useEffect(() => {
    const hydrate = async () => {
      const savedKey = await getPrivateKey();
      if (savedKey) {
        setPrivateKey(savedKey);
        setIsCryptoReady(true);
      }
      await verifySession();
    };
    hydrate();
  }, []);

  const initializeCrypto = useCallback(async () => {
    setIsCryptoReady(false);
    const keyPair = await generateIdentityKeyPair();
    
    const jwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const pubJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    await savePrivateKey(jwk);
    setPrivateKey(jwk);

    await secureFetch('/api/update-crypto-key', {
      method: 'PUT',
      body: JSON.stringify({ publicKeyJwk: pubJwk })
    });

    setIsCryptoReady(true);
    console.log("✅ E2EE Persistent-session initialized.");
  }, []);

  const verifySession = async () => {
    try {
      const response = await secureFetch('/api/auth/me'); 
      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        setUserRole(data.role);
        // Only re-init if we don't have a persistent key
        const savedKey = await getPrivateKey();
        if (!savedKey) await initializeCrypto();
      } else {
        await logout();
      }
    } catch (err) {
      console.error("Auth verify failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  
  const logout = async () => {
    await clearKeys();
    setPrivateKey(null);
    setIsAuthenticated(false);
    setIsCryptoReady(false);
  };

  return (
  <AuthContext.Provider value={{ 
    isAuthenticated, 
    userRole, 
    isLoading,
    isCryptoReady,
    privateKey,
    isHandshaking,      // Correct
    setIsHandshaking,   // Correct
    login,              // Ensure this is defined in your AuthProvider
    verifySession,
    logout
  }}>
    {children}
  </AuthContext.Provider>
);
};

export const useAuth = () => useContext(AuthContext);