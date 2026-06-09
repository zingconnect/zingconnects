import * as libsignal from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// Initialize the persistent store
const store = new ZingSignalStore();

/**
 * 🔒 ZINGCONNECT SIGNAL ENGINE
 * The Singleton orchestrator for E2EE operations.
 */
export const SignalEngine = {
  store,

  /**
   * Sets up local identity, registration ID, and generates the pre-key bundle
   * for backend registration.
   */
  async setupIdentity() {
    // 1. Generate keys
    const identityKeyPair = await libsignal.KeyHelper.generateIdentityKeyPair();
    const registrationId = libsignal.KeyHelper.generateRegistrationId();
    
    // 2. Persist using the store
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    // 3. Prepare bundle for the backend
    const preKeyBundle = await libsignal.KeyHelper.generatePreKeyBundle(registrationId, 1);
    
    return { identityKeyPair, preKeyBundle };
  },



  /**
   * Initialize a new session with a remote user using their PreKey Bundle
   */
  async initializeSession(remoteUserId, preKeyBundle) {
    try {
      const sessionBuilder = new libsignal.SessionBuilder(store, remoteUserId);
      await sessionBuilder.processPreKey(preKeyBundle);
      console.log(`✅ Session successfully established with: ${remoteUserId}`);
      return true;
    } catch (error) {
      console.error("❌ X3DH Handshake failed:", error);
      throw error;
    }
  },

  /**
   * Encrypts a message using the active Double Ratchet session.
   */
  async encrypt(remoteUserId, clearText) {
    const sessionCipher = new libsignal.SessionCipher(store, remoteUserId);
    return await sessionCipher.encrypt(new TextEncoder().encode(clearText));
  },

  /**
   * Decrypts an incoming bundle using the active session.
   */
  async decrypt(remoteUserId, ciphertextBundle) {
    const sessionCipher = new libsignal.SessionCipher(store, remoteUserId);
    const decrypted = await sessionCipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decrypted);
  },
  
  async reset() {
    await store.clearAll();
  }
};

// --- PROXY EXPORTS FOR LEGACY COMPONENT COMPATIBILITY ---
export const initializeSession = SignalEngine.initializeSession;
export const encryptMessage = SignalEngine.encrypt;
export const decryptMessage = SignalEngine.decrypt;
export const setupIdentity = SignalEngine.setupIdentity;