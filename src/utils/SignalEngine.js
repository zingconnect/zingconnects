import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// 1. Resolve module
const libsignal = libsignalModule.default || libsignalModule;

// 2. Map exports safely
const KeyHelper = libsignal.keyhelper || libsignal.KeyHelper;
const SessionBuilder = libsignal.sessionbuilder || libsignal.SessionBuilder;
const SessionCipher = libsignal.sessioncipher || libsignal.SessionCipher;

// DEBUG: This log is CRITICAL. Watch your console for the real method names.
console.log("DEBUG: KeyHelper object:", KeyHelper);

const store = new ZingSignalStore();

const bufferToBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
    
    // Construct bundle for the backend (Serialized to Base64)
    const preKeyBundle = {
      registrationId: registrationId,
      identityKey: bufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
        signature: bufferToBase64(signedPreKey.signature)
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: bufferToBase64(pk.keyPair.pubKey)
      }))
    };
    
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    return { identityKeyPair, preKeyBundle };
  },

 async initializeSession(remoteUserId, preKeyBundle) {
    // Utility to convert Base64 back to ArrayBuffer
    const toBuffer = (base64) => Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;

    const signalBundle = {
      registrationId: parseInt(preKeyBundle.registrationId),
      identityKey: toBuffer(preKeyBundle.identityKey),
      signedPreKey: {
        keyId: preKeyBundle.signedPreKey.keyId,
        publicKey: toBuffer(preKeyBundle.signedPreKey.publicKey),
        signature: toBuffer(preKeyBundle.signedPreKey.signature)
      }
    };

    const SessionBuilder = lib.SessionBuilder || lib.sessionbuilder || lib.default?.SessionBuilder;
    const builder = new SessionBuilder(store, remoteUserId);
    return await builder.processPreKey(signalBundle);
  },

  async encrypt(remoteUserId, clearText) {
    const cipher = new SessionCipher(store, remoteUserId);
    const encoded = new TextEncoder().encode(clearText);
    return await cipher.encrypt(encoded);
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const cipher = new SessionCipher(store, remoteUserId);
    const decoded = await cipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decoded);
  },
  
  async reset() {
    await store.clearAll();
  }
};

export const { initializeSession, encrypt, decrypt, setupIdentity } = SignalEngine;