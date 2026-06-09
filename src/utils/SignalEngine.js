import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// 1. Resolve module safely
const lib = libsignalModule.default || libsignalModule;

const store = new ZingSignalStore();

// Utility for Base64
const bufferToBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const toBuffer = (base64) => Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;

export const SignalEngine = {
  store,

  async setupIdentity() {
    // Access the 'lib' constant directly
    const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
    if (!KeyHelper) throw new Error("KeyHelper not found");

    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    
    const preKeys = [];
    for (let i = 1; i <= 100; i++) {
      preKeys.push(await KeyHelper.generatePreKey(i));
    }
    
    const preKeyBundle = {
      registrationId: registrationId,
      identityKey: bufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: bufferToBase64(signedPreKey.keyPair.pubKey),
        signature: bufferToBase64(signedPreKey.signature)
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: bufferToBase64(pk.keyPair.pubKey)
      }))
    };
    
    await store.saveIdentity('local', identityKeyPair);
    await store.saveRegistrationId(registrationId);
    
    return { identityKeyPair, preKeyBundle };
  },

  async initializeSession(remoteUserId, preKeyBundle) {
    const SessionBuilder = lib.SessionBuilder || lib.sessionbuilder || lib.default?.SessionBuilder;
    if (!SessionBuilder) throw new Error("SessionBuilder not found");

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

export const { initializeSession, encrypt, decrypt, setupIdentity } = SignalEngine;