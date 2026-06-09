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
  
async setupIdentity() {
    // --- DEBUG INSPECTION ---
    console.log("DEBUG: KeyHelper object structure:", KeyHelper);
    console.log("DEBUG: KeyHelper keys:", Object.keys(KeyHelper));
    
    // Check if KeyHelper is a class instance or a static module
    // If KeyHelper is a class, you may need to instantiate it: new KeyHelper()
    
    // 1. Generate identity keys
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    // 2. Generate SignedPreKey
    // Note: If this fails, look at the console log to see if it is named 
    // generateSignedPreKey, generateSignedPreKeyBundle, or similar.
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    
    // 3. Generate One-Time PreKeys
    // If 'generatePreKeys' is missing, the console logs above will reveal the correct name
    if (typeof KeyHelper.generatePreKeys !== 'function') {
        console.error("CRITICAL: generatePreKeys is not a function on KeyHelper. Available methods:", Object.getOwnPropertyNames(KeyHelper));
    }
    const preKeys = await KeyHelper.generatePreKeys(1, 100); 

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
    const builder = new SessionBuilder(store, remoteUserId);
    return await builder.processPreKey(preKeyBundle);
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