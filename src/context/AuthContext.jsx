import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    verifySession();
  }, []);

  // ADDED: Explicit login function to be called from components
  const login = async (slug) => {
    setIsLoading(true);
    // After a successful login API call, verifySession ensures
    // the state (isAuthenticated, role, crypto) is fully populated
    await verifySession();
    setIsLoading(false);
  };

  const initializeCrypto = async () => {
    setIsCryptoReady(false);
    try {
      const module = await import('../utils/SignalEngine');
      const SignalEngine = module.SignalEngine || module.default;
      if (!SignalEngine) throw new Error("SignalEngine module could not be loaded");

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

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      setIsCryptoReady(true);
      return true;
    } catch (err) {
      console.error("Crypto init failed:", err);
      setIsCryptoReady(false);
      return false;
    }
  };

  const verifySession = async () => {
    setIsLoading(true);
    try {
      const response = await secureFetch('/api/agents/me');
      if (!response.ok) {
        setIsAuthenticated(false);
        return;
      }

      const data = await response.json();
      setUser(data.profile);
      setIsAuthenticated(true);
      setUserRole(data.role);

      const module = await import('../utils/SignalEngine');
      const SignalEngine = module.SignalEngine || module.default;

      const savedIdentity = await SignalEngine.store.loadIdentity('local');
      const serverKeysExist = !!(data.profile.publicKeyJwk?.identityKey);

      if (!savedIdentity || !serverKeysExist) {
        const success = await initializeCrypto();
        setIsCryptoReady(success); 
      } else {
        setIsCryptoReady(true);
      }
    } catch (err) {
      console.error("Auth verification sequence failed:", err);
      setIsCryptoReady(false);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    const { SignalEngine } = await import('../utils/SignalEngine');
    await SignalEngine.store.clearAll(); 
    setIsAuthenticated(false);
    setIsCryptoReady(false);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      userRole, 
      isLoading,
      isCryptoReady,
      login, // Exported to be used in AgentSlug
      verifySession,
      initializeCrypto,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);