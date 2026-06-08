import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import * as libsignal from 'libsignal';
import { secureFetch } from "../../api/utils/api";
import { ZingSignalStore } from "../utils/ZingSignalStore"; // Your new store

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null);
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
  
  // Helper to convert ArrayBuffer to Base64
  const bufferToBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

  // 1. Generate Signal Identity Key & Registration ID
  const identityKeyPair = await libsignal.KeyHelper.generateIdentityKeyPair();
  const registrationId = libsignal.KeyHelper.generateRegistrationId();

  // 2. Persist to ZingSignalStore
  const store = new ZingSignalStore();
  await store.saveIdentity('local', identityKeyPair);
  await store.saveRegistrationId(registrationId);

  // 3. Generate PreKey Bundle
  // The '1' represents the current Signed PreKey ID
  const preKeyBundle = await libsignal.KeyHelper.generatePreKeyBundle(registrationId, 1);
  
  // 4. Send to backend with Base64 serialization
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
  console.log("✅ E2EE Persistent-session initialized and keys uploaded.");
}, []);

  const verifySession = async () => {
    try {
      const response = await secureFetch('/api/auth/me'); 
      if (response.ok) {
        const data = await response.json();
        setIsAuthenticated(true);
        setUserRole(data.role);
        // Only re-init if we don't have a persistent key
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
      isLoading,
      isCryptoReady,
      privateKey,
      isHandshaking,
      verifySession,
      logout
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);