import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// 1. Resolve module safely
const lib = libsignalModule.default || libsignalModule;

const store = new ZingSignalStore();

// Robust ArrayBuffer to Base64
const bufferToBase64 = (buf) => {
  if (!buf) return "";
  const bytes = new Uint8Array(buf.buffer || buf);
  let binary = "";
  // Use a loop instead of the spread operator to avoid call stack limits
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

// Robust Base64 to ArrayBuffer
const toBuffer = (base64) => {
  if (!base64) return new ArrayBuffer(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};
export const SignalEngine = {
  store,

 async setupIdentity() {
    const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
    if (!KeyHelper) throw new Error("KeyHelper not found");

    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    
    const preKeys = [];
    for (let i = 1; i <= 100; i++) {
      preKeys.push(await KeyHelper.generatePreKey(i));
    }
    
    const preKeyBundle = {
      registrationId: registrationId,
      identityKey: bufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKey.keyId,
        // Ensure we are accessing the public key correctly
        publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
        signature: bufferToBase64(signedPreKey.signature)
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        // Check both paths just in case:
        publicKey: bufferToBase64(pk.keyPair?.pubKey || pk.pubKey)
      }))
    };

    // DEBUG: Log the bundle before saving to ensure keys are strings
    console.log("[DEBUG] Verifying Keys:", preKeyBundle.preKeys[0]);

    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    return { identityKeyPair, preKeyBundle };
  },

async setupIdentity() {
  const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
  if (!KeyHelper) throw new Error("KeyHelper not found");

  // 1. Generate identity, registration ID, and signed pre-key
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  
  // 🛡️ SECURITY CHECK: Ensure identity keys are valid
  if (!identityKeyPair.pubKey || identityKeyPair.pubKey.byteLength === 0) {
    throw new Error("Identity Key generation failed: Key is empty.");
  }

  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

  // 2. Generate pre-keys with defensive validation
  const preKeys = await Promise.all(
    Array.from({ length: 100 }, async (_, i) => {
      const pk = await KeyHelper.generatePreKey(i + 1);
      // Ensure the generated object contains a public key in expected paths
      if (!pk.keyPair?.pubKey && !pk.pubKey) {
        throw new Error(`PreKey ${i + 1} generation failed: No public key found.`);
      }
      return pk;
    })
  );

  // 3. Construct the bundle for backend transmission
  const preKeyBundle = {
    registrationId,
    identityKey: bufferToBase64(identityKeyPair.pubKey),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
      signature: bufferToBase64(signedPreKey.signature)
    },
    preKeys: preKeys.map(pk => ({
      keyId: pk.keyId,
      publicKey: bufferToBase64(pk.keyPair?.pubKey || pk.pubKey)
    }))
  };

  // 🛡️ Ensure atomic storage persistence
  // We await these to ensure the local store is ready before the app proceeds
  await Promise.all([
    store.saveIdentity('local', identityKeyPair),
    store.saveRegistrationId(registrationId)
  ]);
  
  return { identityKeyPair, preKeyBundle };
},


  async encrypt(remoteUserId, clearText) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const cipher = new SessionCipher(store, remoteUserId);
    const encoded = new TextEncoder().encode(clearText);
    return await cipher.encrypt(encoded);
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const cipher = new SessionCipher(store, remoteUserId);
    const decoded = await cipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decoded);
  },
  
  async reset() {
    await store.clearAll();
  }
};

export const { initializeSession, encrypt, decrypt, setupIdentity } = SignalEngine;