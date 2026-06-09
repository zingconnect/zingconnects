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
    // Access the 'lib' constant directly
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
    publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
    signature: bufferToBase64(signedPreKey.signature)
  },
  preKeys: preKeys.map(pk => {
    const pubKey = pk.keyPair.pubKey;
    
    // CONSOLE LOG: Deep inspection
    console.log(`[DEBUG] KeyID: ${pk.keyId}`);
    console.log(`[DEBUG] pubKey type: ${typeof pubKey}`);
    console.log(`[DEBUG] pubKey value:`, pubKey);
    console.log(`[DEBUG] bufferToBase64 result: '${bufferToBase64(pubKey)}'`);
    
    return {
      keyId: pk.keyId,
      publicKey: bufferToBase64(pubKey)
    };
  })
};

// Final sanity check before database save
console.log("[DEBUG] Final PreKeyBundle Summary:", {
  count: preKeyBundle.preKeys.length,
  firstKeySample: preKeyBundle.preKeys[0].publicKey
});
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    return { identityKeyPair, preKeyBundle };
  },

  async initializeSession(remoteUserId, preKeyBundle) {
    const SessionBuilder = lib.SessionBuilder || lib.sessionbuilder || lib.default?.SessionBuilder;
    if (!SessionBuilder) throw new Error("SessionBuilder not found");

    const signalBundle = {
      registrationId: parseInt(preKeyBundle.registrationId),
      identityKey: toBuffer(preKeyBundle.identityKey),
      signedPreKey: {
        keyId: preKeyBundle.signedPreKey.keyId,
        publicKey: toBuffer(preKeyBundle.signedPreKey.publicKey),
        signature: toBuffer(preKeyBundle.signedPreKey.signature)
      }
    };

    const builder = new SessionBuilder(store, remoteUserId);
    return await builder.processPreKey(signalBundle);
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