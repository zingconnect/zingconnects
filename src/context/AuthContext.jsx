import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";
import { generateIdentityKeyPair } from "../utils/cryptoEngine";
import { savePrivateKey, getPrivateKey, clearKeys } from "../utils/cryptoStorage"; 


const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [user, setUser] = useState(null);
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
    // Use the function from your new cryptoEngine.js
    const keyPair = await generateIdentityKeyPair();
    
    // Exporting the key for storage
    const jwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const pubJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

    // Save to IndexedDB and state
    await savePrivateKey(jwk);
    setPrivateKey(jwk);

    await secureFetch('/api/update-crypto-key', {
      method: 'PUT',
      body: JSON.stringify({ publicKeyJwk: pubJwk })
    });

    setIsCryptoReady(true);
    console.log("✅ E2EE Persistent-session initialized.");
  }, []);

// In AuthContext.jsx
const verifySession = async () => {
  try {
    const response = await secureFetch('/api/auth/me'); 
    if (response.ok) {
      const data = await response.json();
      setIsAuthenticated(true);
      setUserRole(data.role);
      setUser(data.profile); 
      
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

  const login = async (slug) => {
  setIsHandshaking(true);
  try {
    // 1. Mark as authenticated
    setIsAuthenticated(true);
        await verifySession(); 
        const savedKey = await getPrivateKey();
    if (!savedKey) await initializeCrypto();
    
  } catch (err) {
    console.error("Login process failed:", err);
    setIsAuthenticated(false);
  } finally {
    setIsHandshaking(false);
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
    user, 
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