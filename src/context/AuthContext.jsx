import { createContext, useState, useContext, useEffect } from 'react';
import { secureFetch } from "../../api/utils/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCryptoReady, setIsCryptoReady] = useState(false);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  
  // 1. Initialize deviceId as null; it will be populated via Effect
  const [deviceId, setDeviceId] = useState(null);

  useEffect(() => {
    const initEngine = async () => {
      // 2. Load engine and ID asynchronously to avoid race conditions
      const module = await import('../utils/SignalEngine');
      const SignalEngine = module.SignalEngine || module.default;
      const id = await SignalEngine.store.getOrGenerateDeviceId();
      
      setDeviceId(id);
      // 3. Verify session only after we have a confirmed deviceId
      verifySession(id);
    };
    initEngine();
  }, []);

  const initializeCrypto = async () => {
    if (!deviceId) return false;
    setIsCryptoReady(false);
    try {
      const module = await import('../utils/SignalEngine');
      const SignalEngine = module.SignalEngine || module.default;

      const { identityKeyPair, preKeyBundle } = await SignalEngine.setupIdentity(deviceId);
      const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

      const devicePayload = {
        deviceId,
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
      return false;
    }
  };

  const verifySession = async (id) => {
    setIsLoading(true);
    try {
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

      const module = await import('../utils/SignalEngine');
      const SignalEngine = module.SignalEngine || module.default;

      const isThisDeviceRegistered = profile.devices?.some(
        (d) => String(d.deviceId) === String(id)
      );

      const savedIdentity = await SignalEngine.store.getIdentityKeyPair(id);

      if (savedIdentity && isThisDeviceRegistered) {
        setIsCryptoReady(true);
      } else {
        setIsCryptoReady(false);
        console.warn("Device not fully registered.");
      }
    } catch (err) {
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
    window.location.reload(); // Hard refresh to clear memory state
  };

  return (
    <AuthContext.Provider value={{ 
      user, setUser, token, setToken, 
      isAuthenticated, userRole, isLoading, 
      isCryptoReady, verifySession, initializeCrypto, 
      logout, deviceId 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);