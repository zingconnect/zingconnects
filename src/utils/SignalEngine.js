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
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    const preKeys = await KeyHelper.generatePreKeys(1, 100); 
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