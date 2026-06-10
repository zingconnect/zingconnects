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

 const initializeCrypto = async () => {
  // 1. Reset state safely
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
    const response = await secureFetch('/api/agents/me');
    
    if (!response.ok) {
      await logout();
      return;
    }

    const data = await response.json();
    setUser(data);
    setIsAuthenticated(true);
    setUserRole(data.role);

    const module = await import('../utils/SignalEngine');
    const SignalEngine = module.SignalEngine || module.default;

    if (!SignalEngine?.store) {
      throw new Error("SignalEngine or its store is not defined");
    }
    const savedIdentity = await SignalEngine.store.loadIdentity('local');    
    if (!savedIdentity) {
      const cryptoSuccess = await initializeCrypto();
      if (!cryptoSuccess) {
        throw new Error("Cryptography initialization failed");
      }
    } else {
      setIsCryptoReady(true);
    }

  } catch (err) {
    console.error("Auth verification sequence failed:", err);
    setIsAuthenticated(false);
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
      verifySession,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);