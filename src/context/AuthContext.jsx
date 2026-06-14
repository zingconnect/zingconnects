import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { secureFetch } from "../../api/utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [token, setToken] = useState(null); // Add this state
  const [user, setUser] = useState(null);

  useEffect(() => {
    verifySession();
  }, []);

  const login = async (slug) => {
    setIsLoading(true);
    await verifySession();
    setIsLoading(false);
  };

 const initializeCrypto = async () => {
  setIsCryptoReady(false);
  
  try {
    // 2. FIXED DYNAMIC IMPORT: Handle named vs default exports
    const module = await import('../utils/SignalEngine');
    const SignalEngine = module.SignalEngine || module.default;

    if (!SignalEngine) throw new Error("SignalEngine module could not be loaded");

    // 3. Generate Identity
    const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity();
    const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

    // 4. Update Server
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
    console.log("✅ E2EE Persistent-session initialized.");
    return true; // Return success status
  } catch (err) {
    console.error("Crypto init failed:", err);
    setIsCryptoReady(false);
    return false; // Return failure status
  }
};

const verifySession = async () => {
  setIsLoading(true);
  try {
    // 1. Verify Authentication
    const response = await secureFetch('/api/agents/me');
    if (!response.ok) {
      setIsAuthenticated(false);
      return;
    }

    const data = await response.json();
    const profile = data.profile;
    setUser(profile);
    setIsAuthenticated(true);
    setUserRole(data.role);

    // 2. Initialize/Check Crypto
    const module = await import('../utils/SignalEngine');
    const SignalEngine = module.SignalEngine || module.default;

    const savedIdentity = await SignalEngine.store.loadIdentity('local');
    const serverKeysExist = !!(profile.publicKeyJwk?.identityKey);

    if (!savedIdentity || !serverKeysExist) {
      const success = await initializeCrypto();
      // Only set crypto readiness if the handshake succeeded
      setIsCryptoReady(success); 
    } else {
      setIsCryptoReady(true);
    }
  } catch (err) {
    console.error("Auth verification sequence failed:", err);
    // Keep isAuthenticated(true) if it succeeded above, 
    // but flag crypto as failed
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
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      setUser, 
      token,         
      setToken,
      isAuthenticated, 
      userRole, 
      isLoading,
      isCryptoReady,
      login,
      verifySession,
      initializeCrypto,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);