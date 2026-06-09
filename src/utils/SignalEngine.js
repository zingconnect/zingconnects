// Corrected imports: use the named exports directly
import { KeyHelper, SessionBuilder, SessionCipher } from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

const store = new ZingSignalStore();

export const SignalEngine = {
  store,

  async setupIdentity() {
    // 1. Generate keys using the imported KeyHelper constant
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    // 2. Persist using the store
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    // 3. Prepare bundle - FIX: Use KeyHelper (the imported constant), not libsignal
    const preKeyBundle = await KeyHelper.generatePreKeyBundle(registrationId, 1);
    
    return { identityKeyPair, preKeyBundle };
  },

  async initializeSession(remoteUserId, preKeyBundle) {
    try {
      // FIX: Use the imported SessionBuilder constant
      const sessionBuilder = new SessionBuilder(store, remoteUserId);
      await sessionBuilder.processPreKey(preKeyBundle);
      console.log(`✅ Session established with: ${remoteUserId}`);
      return true;
    } catch (error) {
      console.error("❌ X3DH Handshake failed:", error);
      throw error;
    }
  },

  async encrypt(remoteUserId, clearText) {
    // FIX: Use the imported SessionCipher constant
    const sessionCipher = new SessionCipher(store, remoteUserId);
    return await sessionCipher.encrypt(new TextEncoder().encode(clearText));
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    // FIX: Use the imported SessionCipher constant
    const sessionCipher = new SessionCipher(store, remoteUserId);
    const decrypted = await sessionCipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decrypted);
  },
  
  async reset() {
    await store.clearAll();
  }
};