import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [token, setToken] = useState(null); // Add this state

  useEffect(() => {
    verifySession();
  }, []);

 const initializeCrypto = async () => {
  setIsCryptoReady(false);
  setIsLoading(true); // Ensure the app knows we are working
  try {
    const { SignalEngine } = await import('../utils/SignalEngine');
    
    const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity();
    const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

    const response = await secureFetch('/api/update-crypto-key', {
      method: 'PUT',
      body: JSON.stringify({ 
        registrationId: preKeyBundle.registrationId, 
        identityKey: bufferToBase64(identityKeyPair.pubKey), 
        signedPreKey: {
          keyId: preKeyBundle.signedPreKey.keyId,
          publicKey: bufferToBase64(preKeyBundle.signedPreKey.publicKey),
          signature: bufferToBase64(preKeyBundle.signedPreKey.signature)
        },
        preKeys: preKeyBundle.preKeys.map(pk => ({
          keyId: pk.keyId,
          publicKey: bufferToBase64(pk.publicKey)
        }))
      })
    });

    if (!response.ok) throw new Error("Failed to update keys on server");

    setIsCryptoReady(true);
    console.log("✅ E2EE Persistent-session initialized.");
  } catch (err) {
    console.error("Crypto init failed:", err);
    // CRITICAL: Prevent infinite loading
    setIsCryptoReady(false);
  } finally {
    setIsLoading(false);
  }
};


 // Updated verifySession snippet
const verifySession = async () => {
  setIsLoading(true); // Start loading
  try {
    const response = await secureFetch('/api/agents/me');
    if (response.ok) {
      const data = await response.json();
      setIsAuthenticated(true);
      setUserRole(data.role);

      const { SignalEngine } = await import('../utils/SignalEngine');
      const savedIdentity = await SignalEngine.store.loadIdentityKey('local');
      
      if (!savedIdentity) {
        await initializeCrypto(); // This is now awaited
      } else {
        setIsCryptoReady(true);
      }
    } else {
      await logout();
    }
  } catch (err) {
    console.error("Auth verify failed:", err);
  } finally {
    setIsLoading(false); // Only finish loading once everything is fully ready
  }
};

  const logout = async () => {
    // DYNAMIC IMPORT: Accessed only when needed
    const { SignalEngine } = await import('../utils/SignalEngine');
    await SignalEngine.store.clearAll(); 
    setIsAuthenticated(false);
    setIsCryptoReady(false);
  };

  return (
    <AuthContext.Provider value={{ 
      token,         
      setToken,
      isAuthenticated, 
      userRole, 
      isLoading,
      isCryptoReady,
      verifySession,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);