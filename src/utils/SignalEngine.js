import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

// 1. Resolve module
const libsignal = libsignalModule.default || libsignalModule;

// 2. Map exports safely using ONE approach only
const { 
  KeyHelper, 
  SessionBuilder, 
  SessionCipher 
} = libsignal;

// DEBUG: Verify imports
console.log("DEBUG: KeyHelper:", KeyHelper);
console.log("DEBUG: SessionBuilder:", SessionBuilder);

const store = new ZingSignalStore();


export const SignalEngine = {
  store,

  async savePeerBundle(slug, bundle) {
     return await store.savePeerBundle(slug, bundle);
  },
  
async setupIdentity() {
    // 1. Generate identity keys
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    const registrationId = KeyHelper.generateRegistrationId();
    
    // 2. Generate SignedPreKey
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
    
    // 3. Generate One-Time PreKeys (Looping the singular function)
    const preKeys = [];
    for (let i = 1; i <= 100; i++) {
        // Generating a key with a unique ID (e.g., current timestamp or loop index)
        const pk = await KeyHelper.generatePreKey(i); 
        preKeys.push(pk);
    }
    
    // 4. Construct bundle
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
  // Helper to safely convert Base64 to ArrayBuffer
  const toBuffer = (base64) => {
    if (!base64) throw new Error("Missing key data for Signal handshake");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  try {
    const signalBundle = {
      registrationId: parseInt(preKeyBundle.registrationId), // Ensure number type
      identityKey: toBuffer(preKeyBundle.identityKey),
      signedPreKey: {
        keyId: preKeyBundle.signedPreKey.keyId,
        publicKey: toBuffer(preKeyBundle.signedPreKey.publicKey),
        signature: toBuffer(preKeyBundle.signedPreKey.signature)
      }
    };

    const builder = new SessionBuilder(store, remoteUserId);
    return await builder.processPreKey(signalBundle);
  } catch (err) {
    console.error("❌ Signal Session Build Failed:", err);
    throw new Error("Failed to process pre-key bundle. Ensure your keys are valid Base64.");
  }
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