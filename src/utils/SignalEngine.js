import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';
import { bufferToBase64 } from './SignalUtils'; // Helper imported correctly

const lib = libsignalModule.default || libsignalModule;
const store = new ZingSignalStore();

export const SignalEngine = {
  store,

  async setupIdentity() {
    const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
    if (!KeyHelper) throw new Error("KeyHelper not found");

    // 1. Generate identity, registration ID, and signed pre-key
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    
    // 🛡️ SECURITY CHECK: Ensure identity keys are valid
    if (!identityKeyPair.pubKey || identityKeyPair.pubKey.byteLength === 0) {
      throw new Error("Identity Key generation failed: Key is empty.");
    }

    const registrationId = KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

    // 2. Generate pre-keys with defensive validation
    const preKeys = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const pk = await KeyHelper.generatePreKey(i + 1);
        if (!pk.keyPair?.pubKey && !pk.pubKey) {
          throw new Error(`PreKey ${i + 1} generation failed: No public key found.`);
        }
        return pk;
      })
    );

    // 3. Construct the bundle for backend transmission
    const preKeyBundle = {
      registrationId,
      identityKey: bufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
        signature: bufferToBase64(signedPreKey.signature)
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: bufferToBase64(pk.keyPair?.pubKey || pk.pubKey)
      }))
    };

    // 🛡️ Ensure atomic storage persistence
    await Promise.all([
      store.saveIdentity('local', identityKeyPair),
      store.saveRegistrationId(registrationId)
    ]);
    
    return { identityKeyPair, preKeyBundle };
  },

  async encrypt(remoteUserId, clearText) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const cipher = new SessionCipher(store, remoteUserId);
    const encoded = new TextEncoder().encode(clearText);
    return await cipher.encrypt(encoded);
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const cipher = new SessionCipher(store, remoteUserId);
    const decoded = await cipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decoded);
  },
  
  async reset() {
    await store.clearAll();
  }
};

export const { encrypt, decrypt, setupIdentity, store: signalStore } = SignalEngine;