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
    
    // 1. If not authenticated, clear session and exit
    if (!response.ok) {
      await logout();
      return;
    }

    const data = await response.json();
    setIsAuthenticated(true);
    setUserRole(data.role);

    // 2. SAFE DYNAMIC IMPORT: Handle module resolution
    const module = await import('../utils/SignalEngine');
    const SignalEngine = module.SignalEngine || module.default;

    if (!SignalEngine?.store) {
      throw new Error("SignalEngine or its store is not defined");
    }

    // 3. Load Identity
    const savedIdentity = await SignalEngine.store.loadIdentityKey('local');
    
    if (!savedIdentity) {
      // 4. Await the crypto initialization
      const cryptoSuccess = await initializeCrypto();
      if (!cryptoSuccess) {
        throw new Error("Cryptography initialization failed");
      }
    } else {
      setIsCryptoReady(true);
    }
  } catch (err) {
    console.error("Auth verification sequence failed:", err);
    // Ensure we don't leave the user in a broken authenticated state
    setIsAuthenticated(false);
  } finally {
    setIsLoading(false); // Only toggle loading once the entire chain is complete
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