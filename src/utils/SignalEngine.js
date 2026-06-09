import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

/**
 * Robust resolution:
 * Some versions/bundlers place exports inside the 'default' key,
 * while others expose them at the top level. This ensures we catch both.
 */
const libsignal = libsignalModule.default || libsignalModule;

// Extract helpers from the resolved module
const { KeyHelper, SessionBuilder, SessionCipher } = libsignal;

// Final sanity check for environment debugging
if (!KeyHelper) {
  console.error("CRITICAL: libsignal exports not found. Received:", libsignal);
  throw new Error("Failed to initialize libsignal: KeyHelper is undefined.");
}

const store = new ZingSignalStore();

/**
 * 🔒 ZINGCONNECT SIGNAL ENGINE
 */
export const SignalEngine = {
  store,

  async setupIdentity() {
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
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
    return await sessionCipher.encrypt(new TextEncoder().encode(clearText));
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

export const { 
  initializeSession, 
  encrypt, 
  decrypt, 
  setupIdentity 
} = SignalEngine;