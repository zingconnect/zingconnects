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
let isEngineReady = false;

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

isReady: () => isEngineReady,

get deviceId() {
  return this.store.getOrGenerateDeviceId();
}, 

async getOrGenerateDeviceId() {
    return await getStore().getOrGenerateDeviceId();
  },

/**
 * @param {number} deviceId - Unique ID for this specific browser/client instance
 */
async setupIdentity(deviceId = 1) {
  const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
  if (!KeyHelper) throw new Error("KeyHelper not found");
  
  // 1. Generate keys
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  
  const ensureBuffer = (key) => {
    if (!key) throw new Error("Key is null or undefined");
    return key instanceof Uint8Array ? key : new Uint8Array(key);
  };

  const preKeys = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const pk = await KeyHelper.generatePreKey(i + 1);
      const pubKey = pk.keyPair ? pk.keyPair.pubKey : pk.pubKey;
      
      if (!pubKey) {
        throw new Error(`PreKey ${i + 1} generation failed`);
      }
      return { ...pk, extractedPubKey: pubKey };
    })
  );
await store.saveIdentityKeyPair(identityKeyPair, deviceId); 
  await store.saveRegistrationId(registrationId, deviceId);
  await store.saveSignedPreKey(signedPreKey.keyId, signedPreKey, deviceId);
  
 for (const pk of preKeys) {
  if (pk && pk.keyId && pk.extractedPubKey) {
    await store.savePreKey(pk.keyId, pk, deviceId);
  } else {
    console.warn("Skipping malformed PreKey:", pk);
  }
}
    return {
    deviceId, // <--- Return the device ID used
    identityKeyPair,
    preKeyBundle: {
      deviceId,
      registrationId,
      identityKey: bufferToBase64(ensureBuffer(identityKeyPair.pubKey)),
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: bufferToBase64(ensureBuffer(signedPreKey.keyPair.pubKey)),
        signature: bufferToBase64(ensureBuffer(signedPreKey.signature))
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: bufferToBase64(ensureBuffer(pk.extractedPubKey))
      }))
    }
  };
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
  const deviceId = await this.getOrGenerateDeviceId();
  return await this.store.loadIdentity(identifier, deviceId);
}, 

async initialize(userId) {
  console.log("🛡️ Initializing Engine for:", userId);
    const deviceId = await this.getOrGenerateDeviceId();
  const identity = await store.loadIdentity(userId, deviceId);
  
  if (!identity) {
    console.log(`Identity not found for ${userId}, setting up new identity...`);
    await this.setupIdentity(deviceId);
  }
  
  isEngineReady = true;
  return true;
},

async sendMessage(remoteUserId, receiverModel, messageText, conversationId, deviceId, isRetry = false) {
  const lib = getLib();
  const store = getStore();
  
  // Scoping the address to the remote user and the specific session
  const address = new lib.ProtocolAddress(remoteUserId, 1);

  // 1. Session Handshake Logic
  // Now using deviceId to isolate sessions per browser/client
  let session = await store.loadSession(remoteUserId, deviceId);
  
  if (!session || isRetry) {
    if (isRetry) await store.removeSession(remoteUserId, deviceId);

    try {
      // Fetch the bundle for the specific device
      const response = await secureFetch(
        `/api/crypto/bundle/${remoteUserId}?model=${receiverModel}&deviceId=${deviceId}`
      );
      if (!response.ok) throw new Error("Could not fetch crypto bundle");

      const data = await response.json();
      if (!data.success) throw new Error("Bundle data missing");

      const sessionBuilder = new lib.SessionBuilder(store, address);
      const bundle = prepareBundleForSignal(data);
      
      await sessionBuilder.initOutgoing(bundle);
      
      // Save identity bound to the deviceId
      await store.saveIdentity(remoteUserId, bundle.identityKey, deviceId);
    } catch (err) {
      throw new Error(`Handshake failed: ${err.message}`);
    }
  }

  // 2. Encryption
  let encrypted;
  try {
    encrypted = await this.encrypt(remoteUserId, messageText);
  } catch (err) {
    console.error("Encryption failed, resetting session...", err);
    if (!isRetry) {
        return await this.sendMessage(remoteUserId, receiverModel, messageText, conversationId, deviceId, true);
    }
    throw new Error("Ratchet desync: Persistent encryption failure.");
  }

  // 3. Transmission
  const payload = {
    ciphertext: bufferToBase64(encrypted.body),
    iv: encrypted.iv ? bufferToBase64(encrypted.iv) : '',
    ephemeralKey: encrypted.ephemeralKey ? bufferToBase64(encrypted.ephemeralKey) : '',
    counter: encrypted.counter ?? 0,
    previousCounter: encrypted.previousCounter ?? 0,
    type: encrypted.type === 3 ? 'prekey' : 'message',
    deviceId // Include deviceId so server verifies against the correct Public Key
  };

  const response = await secureFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      receiverId: remoteUserId,
      receiverModel,
      isEncrypted: true,
      payload
    })
  });

  const result = await response.json();

  // 4. Handle Server-Side Signature Rejection
  if (!result.success) {
    if (result.error === 'INVALID_SIGNATURE' && !isRetry) {
      console.warn("Signature rejected by server. Recovering...");
      return await this.sendMessage(remoteUserId, receiverModel, messageText, conversationId, deviceId, true);
    }
    throw new Error(result.message || "Transmission rejected.");
  }

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