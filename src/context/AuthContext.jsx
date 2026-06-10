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

  const initializeCrypto = useCallback(async () => {
    setIsCryptoReady(false);
    try {
      // DYNAMIC IMPORT: Defined inside the function scope
      const { SignalEngine } = await import('../utils/SignalEngine');
      
      const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity();
      const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

      await secureFetch('/api/update-crypto-key', {
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

      setIsCryptoReady(true);
      console.log("✅ E2EE Persistent-session initialized.");
    } catch (err) {
      console.error("Crypto init failed:", err);
    }
  }, []);

const verifySession = async () => {
  setIsLoading(true);
  try {
    const response = await secureFetch('/api/agents/me');

    // 1. Handle success: User is authenticated
    if (response.ok) {
      const data = await response.json();
      setIsAuthenticated(true);
      setUserRole(data.role);

      const { SignalEngine } = await import('../utils/SignalEngine');
      const savedIdentity = await SignalEngine.store.loadIdentityKey('local');
      
      if (!savedIdentity) {
        await initializeCrypto();
      } else {
        setIsCryptoReady(true);
      }
    } 
    // 2. Handle 401 specifically: The user is truly NOT authenticated
    else if (response.status === 401) {
      console.warn("Session invalid/expired. Logging out.");
      await logout(); 
    } 
    // 3. Handle other errors (500s, 403s): Do NOT logout yet!
    else {
      console.error(`Auth check failed with status: ${response.status}`);
      // Don't call logout() here, allow the app to retry or show an error
    }
  } catch (err) {
    console.error("Auth verify failed (Network error):", err);
    // Keep isAuthenticated as false, but don't wipe the SignalEngine store
    // so the user can try again without re-initializing the whole crypto stack
  } finally {
    setIsLoading(false);
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