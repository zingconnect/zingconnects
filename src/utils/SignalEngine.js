import * as libsignalModule from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';
import { bufferToBase64, prepareBundleForSignal } from './SignalUtils';

const lib = libsignalModule.default || libsignalModule;
const store = new ZingSignalStore();
console.log("DEBUG: libsignal keys:", Object.keys(lib));

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
  },

async initializeSession(remoteUserId, peerBundle) {
  const lib = libsignalModule.default || libsignalModule;
  const formattedBundle = prepareBundleForSignal(peerBundle);
  
  // LOG THE BUNDLE TO VERIFY STRUCTURE
  console.log("DEBUG: Bundle being sent to initIncoming:", formattedBundle);
  
  const address = new lib.ProtocolAddress(remoteUserId, 1);
  const SessionBuilder = lib.SessionBuilder || lib.default?.SessionBuilder;
  const builder = new SessionBuilder(store, address);
  
  if (typeof builder.initIncoming === 'function') {
    // Some library versions require the raw peerBundle instead of the "prepared" one
    // Try passing the raw peerBundle if the prepared one fails
    await builder.initIncoming(formattedBundle);
  } else {
    throw new Error("initIncoming not found.");
  }
  
  console.log(`✅ Session initialized for ${remoteUserId}`);
},

async sendMessage(remoteUserId, messageText) {
  const lib = libsignalModule.default || libsignalModule;
    const hasSession = await store.loadSession(remoteUserId);
 if (!hasSession) {
  const response = await secureFetch(`/api/users/crypto-bundle/${remoteUserId}`);
  const rawBundle = await response.json();
  // Ensure the bundle is prepared before the builder processes it
  const preparedBundle = prepareBundleForSignal(rawBundle);
  
  const sessionBuilder = new lib.SessionBuilder(store, remoteUserId);
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
  
  // 1. Decrypt (SessionCipher handles Type 3 to Type 1 transition automatically)
  const cipher = new SessionCipher(store, remoteUserId);
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