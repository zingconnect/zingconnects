import * as libsignalModule from 'libsignal';
import { Buffer } from 'buffer'; 
import { ZingSignalStore } from './ZingSignalStore';
import { bufferToBase64, prepareBundleForSignal } from './SignalUtils';
import { secureFetch } from "../../api/utils/api";

const lib = libsignalModule.default || libsignalModule;
const store = new ZingSignalStore(lib);
let isEngineReady = false;

export const SignalEngine = {
  get store() { return store; },
  isReady: () => isEngineReady,

  async getOrGenerateDeviceId() {
    return await store.getOrGenerateDeviceId();
  },

/**
 * Generates new identity and registers with store using scoped identifier
 */
async setupIdentity(identifier, deviceId) {
  // CRITICAL: Prevent execution if parameters are missing
  if (!identifier) throw new Error("setupIdentity: identifier (userId) is required.");
  if (!deviceId) throw new Error("setupIdentity: deviceId is required.");
  
  const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
  if (!KeyHelper) throw new Error("KeyHelper not found");
  
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  
  const preKeys = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const pk = await KeyHelper.generatePreKey(i + 1);
      return { ...pk, extractedPubKey: pk.keyPair?.pubKey || pk.pubKey };
    })
  );

  // Save to store with identifier scope
  // The store uses these to create the 'identifier_deviceId_type' key
  await store.saveIdentity(identifier, identityKeyPair, deviceId);
  await store.saveRegistrationId(identifier, registrationId, deviceId);
  await store.savePreKey(identifier, signedPreKey.keyId, signedPreKey, deviceId);
  
  for (const pk of preKeys) {
    if (pk?.keyId && pk.extractedPubKey) {
      await store.savePreKey(identifier, pk.keyId, pk, deviceId);
    }
  }

 return { 
    preKeyBundle: {
      registrationId,
      identityKey: identityKeyPair.pubKey, // Ensure this matches your library's output
      signedPreKey,
      preKeys // You were missing this!
    }
  };
},

  async encrypt(identifier, remoteUserId, clearText) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const address = new lib.ProtocolAddress(remoteUserId, 1);
    const cipher = new SessionCipher(this.store, address);
    
    const encoded = new TextEncoder().encode(clearText);
    return await cipher.encrypt(Buffer.from(encoded));
  },

  async decrypt(identifier, remoteUserId, ciphertextBundle) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const address = new lib.ProtocolAddress(remoteUserId, 1);
    const cipher = new SessionCipher(this.store, address);
    const bundle = Buffer.isBuffer(ciphertextBundle) ? ciphertextBundle : Buffer.from(ciphertextBundle);
    
    const decrypted = await cipher.decrypt(bundle);
    return new TextDecoder().decode(decrypted);
  },


 async initialize(userId) {
  if (!userId) {
    console.error("SignalEngine: initialize called without userId.");
    return false;
  }

  // 1. Force retrieval of a validated string
  const deviceId = await this.getOrGenerateDeviceId();
  
  // 2. Strict type check (prevents undefined or null from passing)
  if (!deviceId || typeof deviceId !== 'string') {
    throw new Error("CRITICAL: deviceId failed to resolve to a valid string.");
  }

  console.log(`🛡️ Initializing Engine for ${userId} | Target DeviceID: ${deviceId}`);
  
  // 3. Load identity using the exact same variable
  const identity = await this.store.loadIdentity(userId, deviceId);
  
  if (!identity) {
    console.log(`No identity found. Registering new one for: ${userId} / ${deviceId}`);
    
    // 4. Pass the validated variables directly
    await this.setupIdentity(userId, deviceId);
  } else {
    console.log("Identity found. Reusing existing session state.");
  }

  isEngineReady = true;
  return true;
},

  async sendMessage(remoteUserId, receiverModel, messageText, conversationId, identifier, isRetry = false) {
    const deviceId = await this.getOrGenerateDeviceId();
    const address = new lib.ProtocolAddress(remoteUserId, 1);

    // 1. Load session scoped to identifier and remote user
    let session = await store.loadSession(identifier, remoteUserId, deviceId);
    
    if (!session || isRetry) {
      if (isRetry) await store.removeSession(identifier, remoteUserId, deviceId);

      try {
        const response = await secureFetch(
          `/api/crypto/bundle/${remoteUserId}?model=${receiverModel}&deviceId=${deviceId}`
        );
        const data = await response.json();
        if (!data.success) throw new Error("Bundle data missing");

        const sessionBuilder = new lib.SessionBuilder(store, address);
        const bundle = prepareBundleForSignal(data);
        
        await sessionBuilder.initOutgoing(bundle);
        await store.saveIdentity(identifier, bundle.identityKey, deviceId);
      } catch (err) {
        throw new Error(`Handshake failed: ${err.message}`);
      }
    }

    // 2. Encryption
    let encrypted;
    try {
      encrypted = await this.encrypt(identifier, remoteUserId, messageText);
    } catch (err) {
      if (!isRetry) {
        return await this.sendMessage(remoteUserId, receiverModel, messageText, conversationId, identifier, true);
      }
      throw new Error("Ratchet desync: Persistent encryption failure.");
    }

    // 3. Transmission
    const payload = {
      ciphertext: bufferToBase64(encrypted.body),
      type: encrypted.type === 3 ? 'prekey' : 'message',
      deviceId
    };

    const response = await secureFetch('/api/messages/send', {
      method: 'POST',
      body: JSON.stringify({ conversationId, receiverId: remoteUserId, receiverModel, payload })
    });

    const result = await response.json();
    return result;
  },

  async receiveMessage(identifier, remoteUserId, messageBundle) {
    const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
    const address = new lib.ProtocolAddress(remoteUserId, 1);
    const cipher = new SessionCipher(this.store, address);
    const decrypted = await cipher.decrypt(messageBundle);
    return new TextDecoder().decode(decrypted);
  },

  async reset() { await store.clearAll(); }
};

export const encrypt = SignalEngine.encrypt.bind(SignalEngine);
export const decrypt = SignalEngine.decrypt.bind(SignalEngine);
export const setupIdentity = SignalEngine.setupIdentity.bind(SignalEngine);
export const sendMessage = SignalEngine.sendMessage.bind(SignalEngine);
export const receiveMessage = SignalEngine.receiveMessage.bind(SignalEngine);
export const signalStore = store;