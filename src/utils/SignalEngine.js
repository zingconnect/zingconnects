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
   * Initialize a new session with a remote user using their PreKey Bundle
   */
  async initializeSession(remoteUserId, preKeyBundle) {
    try {
      // libsignal's SessionBuilder requires the store to implement specific methods
      const sessionBuilder = new libsignal.SessionBuilder(store, remoteUserId);
      
      // Ensure the bundle is in the format: 
      // { identityKey, signedPreKey, preKeyId, preKeyPublic, registrationId }
      await sessionBuilder.processPreKey(preKeyBundle);
      console.log(`✅ Session successfully established with: ${remoteUserId}`);
      return true;
    } catch (error) {
      console.error("❌ X3DH Handshake failed:", error);
      throw error;
    }
  },

  async encrypt(remoteUserId, clearText) {
    const sessionCipher = new libsignal.SessionCipher(store, remoteUserId);
    // Encrypt returns: { type: number, body: string }
    return await sessionCipher.encrypt(new TextEncoder().encode(clearText));
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const sessionCipher = new libsignal.SessionCipher(store, remoteUserId);
    const decrypted = await sessionCipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decrypted);
  }
};