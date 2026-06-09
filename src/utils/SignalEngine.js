import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// 1. Resolve base
const lib = libsignalModule.default || libsignalModule;

// 2. Validate early
if (!lib || Object.keys(lib).length === 0) {
  console.error("CRITICAL: libsignal failed to load. Check node_modules.");
}

// 3. Eagerly assign (Use fallback to ensure we find the class)
const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
const SessionBuilder = lib.SessionBuilder || lib.sessionbuilder || lib.default?.SessionBuilder;
const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;

// 4. Final safety check
if (!KeyHelper) console.error("KeyHelper is still undefined. Check libsignal package.");

const store = new ZingSignalStore();

export const SignalEngine = {
  store,

  async savePeerBundle(slug, bundle) {
    return await store.savePeerBundle(slug, bundle);
  },

  async setupIdentity() {
    const KeyHelper = getKeyHelper();
    if (!KeyHelper) throw new Error("KeyHelper not found");

    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    
    const preKeys = [];
    for (let i = 1; i <= 100; i++) {
      const pk = await KeyHelper.generatePreKey(i); 
      preKeys.push(pk);
    }
    
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
    const SessionBuilder = getSessionBuilder();
    if (!SessionBuilder) throw new Error("SessionBuilder not found");

    const toBuffer = (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    };

    const signalBundle = {
      registrationId: parseInt(preKeyBundle.registrationId),
      identityKey: toBuffer(preKeyBundle.identityKey),
      signedPreKey: {
        keyId: preKeyBundle.signedPreKey.keyId,
        publicKey: toBuffer(preKeyBundle.signedPreKey.publicKey),
        signature: toBuffer(preKeyBundle.signedPreKey.signature)
      }
    };

    const builder = new SessionBuilder(store, remoteUserId);
    return await builder.processPreKey(signalBundle);
  },

  async encrypt(remoteUserId, clearText) {
    const SessionCipher = getSessionCipher();
    const cipher = new SessionCipher(store, remoteUserId);
    const encoded = new TextEncoder().encode(clearText);
    return await cipher.encrypt(encoded);
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const SessionCipher = getSessionCipher();
    const cipher = new SessionCipher(store, remoteUserId);
    const decoded = await cipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decoded);
  },
  
  async reset() {
    await store.clearAll();
  }
};

export const { initializeSession, encrypt, decrypt, setupIdentity } = SignalEngine;