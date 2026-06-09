import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

/**
 * Robust resolution of libsignal exports to handle both 
 * direct ESM named exports and 'default' export wrappers.
 */
const libsignal = libsignalModule.default || libsignalModule;
const { KeyHelper, SessionBuilder, SessionCipher } = libsignal;

const store = new ZingSignalStore();

/**
 * 🔒 ZINGCONNECT SIGNAL ENGINE
 * The Singleton orchestrator for E2EE operations.
 */
export const SignalEngine = {
  store,

  async setupIdentity() {
    // 1. Generate keys
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    // 2. Persist using the store
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    // 3. Prepare bundle for the backend
    const preKeyBundle = await KeyHelper.generatePreKeyBundle(registrationId, 1);
    
    return { identityKeyPair, preKeyBundle };
  },

  async initializeSession(remoteUserId, preKeyBundle) {
    try {
      const sessionBuilder = new SessionBuilder(store, remoteUserId);
      await sessionBuilder.processPreKey(preKeyBundle);
      console.log(`✅ Session successfully established with: ${remoteUserId}`);
      return true;
    } catch (error) {
      console.error("❌ X3DH Handshake failed:", error);
      throw error;
    }
  },

  async encrypt(remoteUserId, clearText) {
    const sessionCipher = new SessionCipher(store, remoteUserId);
    const encrypted = await sessionCipher.encrypt(new TextEncoder().encode(clearText));
    return encrypted;
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const sessionCipher = new SessionCipher(store, remoteUserId);
    const decrypted = await sessionCipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decrypted);
  },
  
  async reset() {
    await store.clearAll();
  }
};

// --- PROXY EXPORTS ---
export const { 
  initializeSession, 
  encrypt, 
  decrypt, 
  setupIdentity 
} = SignalEngine;