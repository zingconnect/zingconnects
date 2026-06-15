import { createContext, useState, useContext, useEffect } from 'react';
import { secureFetch } from "../../api/utils/api";

const AuthContext = createContext(null);

// Helper to persist/generate deviceId per browser instance
const getOrGenerateDeviceId = () => {
  let deviceId = localStorage.getItem('zing_device_id');
  if (!deviceId) {
    // Generate a simple numeric ID for the array index
    deviceId = Math.floor(Math.random() * 1000000).toString();
    localStorage.setItem('zing_device_id', deviceId);
  }
  return parseInt(deviceId);
};

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  
  // Track deviceId in state
  const [deviceId] = useState(() => getOrGenerateDeviceId());

  useEffect(() => {
    verifySession();
  }, []);

  const initializeCrypto = async () => {
    setIsCryptoReady(false);
    try {
      const module = await import('../utils/SignalEngine');
      const SignalEngine = module.SignalEngine || module.default;

      // Pass deviceId to engine to scope keys
      const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity(deviceId);
      const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

      const devicePayload = {
        deviceId, // Send unique device ID to server
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
      };

      const response = await secureFetch('/api/crypto/add-device', {
        method: 'POST',
        body: JSON.stringify(devicePayload)
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

      // Check local store specifically for this deviceId
      const savedIdentity = await SignalEngine.store.getIdentityKeyPair(deviceId);
      const isReadyOnServer = !!data.profile.isCryptoReady;

      if (!savedIdentity || !isReadyOnServer) {
        console.log("Device crypto not initialized. Running setup...");
        const success = await initializeCrypto();
        setIsCryptoReady(success);
      } else {
        setIsCryptoReady(true);
      }
    } catch (err) {
      console.error("Auth verification failed:", err);
      setIsCryptoReady(false);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    const { SignalEngine } = await import('../utils/SignalEngine');
    await SignalEngine.store.clearAll();
    localStorage.removeItem('zing_device_id'); // Clear device ID on logout
    setIsAuthenticated(false);
    setIsCryptoReady(false);
  };

  return (
    <AuthContext.Provider value={{ 
      user, setUser, token, setToken, 
      isAuthenticated, userRole, isLoading, 
      isCryptoReady, verifySession, initializeCrypto, 
      logout, deviceId // Exposed for sendMessage
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);