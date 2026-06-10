import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';
import { bufferToBase64, prepareBundleForSignal } from './SignalUtils';

const lib = libsignalModule.default || libsignalModule;
const getAddress = (lib, userId) => new lib.ProtocolAddress(userId, 1);
const store = new ZingSignalStore();

export const SignalEngine = {
  store,
async setupIdentity() {
  const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
  if (!KeyHelper) throw new Error("KeyHelper not found");
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  const getBytes = (obj) => {
    if (!obj) return null;
    // Check common locations: pubKey, public, or the object itself if it's already a buffer
    const key = obj.pubKey || obj.public || obj;
    return key instanceof Uint8Array ? key.buffer : key;
  };
  const preKeys = await Promise.all(
    Array.from({ length: 100 }, async (_, i) => {
      const pk = await KeyHelper.generatePreKey(i + 1);
      const pubKey = getBytes(pk.keyPair || pk);
      
      if (!pubKey) {
        throw new Error(`PreKey ${i + 1} generation failed: No public key found in ${JSON.stringify(Object.keys(pk))}`);
      }
      return { ...pk, extractedPubKey: pubKey };
    })
  );
  const preKeyBundle = {
    registrationId,
    identityKey: bufferToBase64(getBytes(identityKeyPair)),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: bufferToBase64(getBytes(signedPreKey.keyPair)),
      signature: bufferToBase64(signedPreKey.signature)
    },
    preKeys: preKeys.map(pk => ({
      keyId: pk.keyId,
      publicKey: bufferToBase64(pk.extractedPubKey)
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
    const lib = libsignalModule.default || libsignalModule;
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const address = getAddress(lib, remoteUserId);
    const cipher = new SessionCipher(store, address);
    
    const encoded = new TextEncoder().encode(clearText);
    return await cipher.encrypt(encoded);
  },

  async decrypt(remoteUserId, ciphertextBundle) {
    const lib = libsignalModule.default || libsignalModule;
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const address = getAddress(lib, remoteUserId);
    const cipher = new SessionCipher(store, address);
    
    const decoded = await cipher.decrypt(ciphertextBundle);
    return new TextDecoder().decode(decoded);
  },
  async reset() {
    await store.clearAll();
  },

async initializeSession(remoteUserId, peerBundle) {
  const lib = libsignalModule.default || libsignalModule;
  const bundle = prepareBundleForSignal(peerBundle);
  const preKeyBundle = {
    identityKey: bundle.identityKey,
    registrationId: bundle.registrationId,
    signedPreKey: bundle.signedPreKey,
    preKey: bundle.preKey || null
  };

  const address = new lib.ProtocolAddress(remoteUserId, 1);
  const SessionBuilder = new (lib.SessionBuilder || lib.default?.SessionBuilder)(store, address);

 try {
    await SessionBuilder.initIncoming(preKeyBundle);
  } catch (err) {
    // Check if the session was actually saved
    const session = await store.loadSession(remoteUserId);
    if (session) {
      console.log(`✅ Session successfully persisted for ${remoteUserId}`);
    } else {
      console.error("Critical: Handshake truly failed to persist", err);
      throw err;
    }
  }

  console.log(`✅ Session initialized for ${remoteUserId}`);
},

async loadIdentity(identifier) {
    return await this.store.loadIdentity(identifier);
  },

async initialize(userId) {
    console.log("🛡️ Initializing Engine for:", userId);
    const identity = await store.loadIdentity('local');
    if (!identity) {
      await this.setupIdentity();
    }
    return true;
  },

async sendMessage(remoteUserId, messageText) {
    const lib = libsignalModule.default || libsignalModule;
    const hasSession = await store.loadSession(remoteUserId);

    if (!hasSession) {
      const response = await secureFetch(`/api/users/crypto-bundle/${remoteUserId}`);
      const rawBundle = await response.json();
      const preparedBundle = prepareBundleForSignal(rawBundle);
      
      // 🛡️ FIX: Use ProtocolAddress object here as well
      const address = getAddress(lib, remoteUserId);
      const sessionBuilder = new lib.SessionBuilder(store, address);
      await sessionBuilder.processPreKey(preparedBundle);
    }
  const encrypted = await this.encrypt(remoteUserId, messageText);
    socket.emit('message', {
    to: remoteUserId,
    ciphertext: encrypted.body,
    type: encrypted.type, // 3: PreKeyMessage, 1: Normal
    registrationId: await store.getLocalRegistrationId()
  });
},

async receiveMessage(remoteUserId, messageBundle) {
  const lib = libsignalModule.default || libsignalModule;
  const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
  
  // 🛡️ FIX: Create the ProtocolAddress object for the session
  const address = new lib.ProtocolAddress(remoteUserId, 1);
  
  // 1. Decrypt using the ProtocolAddress object
  const cipher = new SessionCipher(store, address);
  const decrypted = await cipher.decrypt(messageBundle);
  
  return new TextDecoder().decode(decrypted);
}

};

export const encrypt = SignalEngine.encrypt.bind(SignalEngine);
export const decrypt = SignalEngine.decrypt.bind(SignalEngine);
export const setupIdentity = SignalEngine.setupIdentity.bind(SignalEngine);
export const initializeSession = SignalEngine.initializeSession.bind(SignalEngine);
export const sendMessage = SignalEngine.sendMessage.bind(SignalEngine);
export const receiveMessage = SignalEngine.receiveMessage.bind(SignalEngine);
export const signalStore = store;