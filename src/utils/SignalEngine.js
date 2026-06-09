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

export const SignalEngine = {
  store,

  async savePeerBundle(slug, bundle) {
     return await store.savePeerBundle(slug, bundle);
  },
  
async setupIdentity() {
    // 1. Generate identity keys
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    // 2. Generate SignedPreKey
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    
    // 3. Generate One-Time PreKeys (Looping the singular function)
    const preKeys = [];
    for (let i = 1; i <= 100; i++) {
        // Generating a key with a unique ID (e.g., current timestamp or loop index)
        const pk = await KeyHelper.generatePreKey(i); 
        preKeys.push(pk);
    }
    
    // 4. Construct bundle
    const preKeyBundle = {
      identityKey: identityKeyPair.pubKey,
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: signedPreKey.keyPair.pubKey,
        signature: signedPreKey.signature
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: pk.keyPair.pubKey
      }))
    };
    
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    return { identityKeyPair, preKeyBundle };
  },

 async initializeSession(remoteUserId, preKeyBundle) {
  const formattedBundle = {
    registrationId: preKeyBundle.registrationId,
    identityKey: preKeyBundle.identityKey,
    signedPreKey: preKeyBundle.signedPreKey,
    preKey: preKeyBundle.preKey // The specific one-time key if present
  };

  const builder = new SessionBuilder(store, remoteUserId);
  
  // 2. Defensive check
  if (typeof builder.processPreKey !== 'function') {
    console.error("DEBUG: Builder object:", builder);
    throw new Error("SessionBuilder.processPreKey is not a function. Check libsignal import.");
  }

  return await builder.processPreKey(formattedBundle);
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