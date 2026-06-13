import * as libsignalModule from 'libsignal';
import { Buffer } from 'buffer'; 
import { ZingSignalStore} from './ZingSignalStore';
import { bufferToBase64, prepareBundleForSignal } from './SignalUtils';
import { secureFetch } from "../../api/utils/api";

const lib = libsignalModule.default || libsignalModule;
const getAddress = (lib, userId) => new lib.ProtocolAddress(userId, 1);
const store = new ZingSignalStore(lib);

let _lib = null;
let _store = null;

const getLib = () => {
  if (!_lib) _lib = libsignalModule.default || libsignalModule;
  return _lib;
};

const getStore = () => {
  if (!_store) _store = new ZingSignalStore(getLib());
  return _store;
};

export const SignalEngine = {
get store() { return getStore(); },

async setupIdentity() {
  const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
  if (!KeyHelper) throw new Error("KeyHelper not found");
  
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  
  const getBytes = (obj) => {
    if (!obj) return null;
    const key = obj.pubKey || obj.public || obj;
    return key instanceof Uint8Array ? key.buffer : key;
  };

  const preKeys = await Promise.all(
    Array.from({ length: 100 }, async (_, i) => {
      const pk = await KeyHelper.generatePreKey(i + 1);
      const pubKey = getBytes(pk.keyPair || pk);
      
      if (!pubKey) {
        throw new Error(`PreKey ${i + 1} generation failed`);
      }
      return { ...pk, extractedPubKey: pubKey };
    })
  );

  // 1. Persist everything using the existing store methods
  await Promise.all([
    // Use the combined method you created in ZingSignalStore
    store.saveIdentityKeyPair(identityKeyPair),
    store.saveRegistrationId(registrationId),
    store.saveSignedPreKey(signedPreKey.keyId, signedPreKey),
    ...preKeys.map(pk => store.savePreKey(pk.keyId, pk))
  ]);
  
  // 2. Prepare the bundle for the server
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

  return { identityKeyPair, preKeyBundle };
},

async encrypt(remoteUserId, clearText) {
  const lib = getLib();
  const store = this.store; // Use the getter
  const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
  const address = new lib.ProtocolAddress(remoteUserId, 1);
  const cipher = new SessionCipher(store, address);
  
  const encoded = new TextEncoder().encode(clearText);
  const bufferMessage = Buffer.from(encoded); 
  
  return await cipher.encrypt(bufferMessage);
},


async decrypt(remoteUserId, ciphertextBundle) {
  const lib = getLib();
  const store = this.store; 
  
  const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
  const address = new lib.ProtocolAddress(remoteUserId, 1);
  const cipher = new SessionCipher(store, address);
    const bundle = Buffer.isBuffer(ciphertextBundle) 
    ? ciphertextBundle 
    : Buffer.from(ciphertextBundle);
  
  const decrypted = await cipher.decrypt(bundle);
  return new TextDecoder().decode(decrypted);
},

  async reset() {
    await store.clearAll();
  },

async initializeSession(remoteUserId, peerBundle) {
    const lib = getLib();
    // 1. Prepare the bundle first
    const preKeyBundle = prepareBundleForSignal(peerBundle);
    
    // 2. Now you can safely log it
    console.log("DEBUG: PreKeyBundle identityKey is instance of Buffer:", Buffer.isBuffer(preKeyBundle.identityKey));

    const address = new lib.ProtocolAddress(remoteUserId, 1);
    const sessionBuilder = new lib.SessionBuilder(this.store, address);

    try {
      await sessionBuilder.initIncoming(preKeyBundle);
    } catch (err) {
      const session = await this.store.loadSession(remoteUserId);
      if (!session) throw err;
    }
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

async sendMessage(remoteUserId, receiverModel = 'User', messageText) {
  const lib = getLib();
  const store = getStore();
  const address = new lib.ProtocolAddress(remoteUserId, 1);

  // 1. Ensure the session exists
  let session = await store.loadSession(remoteUserId);

  if (!session) {
    console.log(`🔒 Establishing new session for ${remoteUserId}`);
    const response = await secureFetch(`/api/crypto/bundle/${remoteUserId}?model=${receiverModel}`);
    if (!response.ok) throw new Error("Could not fetch crypto bundle");
    
    const data = await response.json();
    
    // MODIFICATION: The backend returns keys at the root, so check 'success' instead of 'data.bundle'
    if (!data.success) throw new Error("Bundle data missing from response");
    
    const sessionBuilder = new lib.SessionBuilder(store, address);
    
    // MODIFICATION: Pass 'data' directly, not 'data.bundle'
    await sessionBuilder.initOutgoing(prepareBundleForSignal(data));
    
    session = await store.loadSession(remoteUserId);
    if (!session) throw new Error("Session handshake completed but failed to persist.");
  }

  // 2. Encrypt ONCE. The Ratchet advances here.
  let encrypted;
  try {
    encrypted = await this.encrypt(remoteUserId, messageText);
  } catch (err) {
    console.error("Encryption failed: Possible Ratchet Desync.", err);
    throw new Error("Encryption failed. Please refresh the chat to re-sync.");
  }

  // 3. Transmission
  const response = await secureFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      receiverId: remoteUserId,
      receiverModel,
      isEncrypted: true,
      payload: {
        ciphertext: encrypted.body,
        iv: encrypted.iv || '',
        ephemeralKey: encrypted.ephemeralKey || '',
        counter: encrypted.counter ?? 0,
        type: encrypted.type === 3 ? 'prekey' : 'message'
      }
    })
  });

  const result = await response.json();
  if (!result.success) throw new Error(result.message || "Transmission rejected.");
  
  return result;
},

async receiveMessage(remoteUserId, messageBundle) {
  const lib = getLib();
  const store = this.store; // Use the getter
  const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
  const address = new lib.ProtocolAddress(remoteUserId, 1);
  
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