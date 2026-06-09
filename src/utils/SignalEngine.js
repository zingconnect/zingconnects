import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// 1. Resolve the module correctly
const libsignal = libsignalModule.default || libsignalModule;

// 2. Map lowercase exports to the capitalized constants your code expects
// This handles the specific structure revealed by your debug logs
const KeyHelper = libsignal.keyhelper || libsignal.KeyHelper;
const SessionBuilder = libsignal.sessionbuilder || libsignal.SessionBuilder;
const SessionCipher = libsignal.sessioncipher || libsignal.SessionCipher;

// Final sanity check
if (!KeyHelper) {
  console.error("CRITICAL: Could not map KeyHelper. Received structure:", libsignal);
  throw new Error("Failed to initialize libsignal: KeyHelper mapping failed.");
}

const store = new ZingSignalStore();

/**
 * 🔒 ZINGCONNECT SIGNAL ENGINE
 * The Singleton orchestrator for E2EE operations.
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