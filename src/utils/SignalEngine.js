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
    // A. Generate Identity Keys
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    // B. Persist
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    // C. Resolve the bundle method dynamically
    // Some versions use 'generatePreKeyBundle', others 'generatePreKeyStoreBundle'
    const bundleFn = KeyHelper.generatePreKeyBundle || KeyHelper.generatePreKeyStoreBundle;
    
    if (!bundleFn) {
        throw new Error("Could not find a valid bundle generation method on KeyHelper.");
    }

    const preKeyBundle = await bundleFn(registrationId, 1);
    
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