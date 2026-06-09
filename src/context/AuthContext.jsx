import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";
import { SignalEngine } from '../utils/SignalEngine';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);

  // 1. Initial Load: Verify identity and session
  useEffect(() => {
    verifySession();
  }, []);

  const initializeCrypto = useCallback(async () => {
    setIsCryptoReady(false);
    try {
      // Use the centralized engine we built
      const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity();
      const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

      await secureFetch('/api/update-crypto-key', {
        method: 'PUT',
        body: JSON.stringify({ 
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
    try {
      const response = await secureFetch('/api/auth/me'); 
      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        setUserRole(data.role);

        // Check if we already have an identity stored in IndexedDB
        const savedIdentity = await SignalEngine.store.loadIdentityKey('local');
        if (!savedIdentity) {
            await initializeCrypto();
        } else {
            setIsCryptoReady(true);
        }
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
    // Clear storage properly
    // You should add a clearKeys method to ZingSignalStore
    await SignalEngine.store.clearAll(); 
    setIsAuthenticated(false);
    setIsCryptoReady(false);
  };

  return (
    <AuthContext.Provider value={{ 
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