import * as libsignalModule from 'libsignal';
import { Buffer } from 'buffer'; 
import { ZingSignalStore, dbPromise } from './ZingSignalStore';
import { bufferToBase64, prepareBundleForSignal } from './SignalUtils';
import { secureFetch } from "../../api/utils/api";

const lib = libsignalModule.default || libsignalModule;
const getAddress = (lib, userId) => new lib.ProtocolAddress(userId, 1);
const store = new ZingSignalStore(lib);

export const SignalEngine = {
  store,

async setupIdentity() {
  const KeyHelper = lib.KeyHelper || lib.keyhelper || lib.default?.KeyHelper;
  if (!KeyHelper) throw new Error("KeyHelper not found");
  
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  
  // Helper to extract keys
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

 const db = await dbPromise; // Ensure you have access to your dbPromise
  await Promise.all([
    store.saveIdentity('local', identityKeyPair.pubKey), // Save pubKey
    db.put('identity', identityKeyPair.privKey, 'local_priv'), // Save privKey
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
  const bufferMessage = Buffer.from(encoded); 
  
  return await cipher.encrypt(bufferMessage);
},

async decrypt(remoteUserId, ciphertextBundle) {
  const lib = libsignalModule.default || libsignalModule;
  const SessionCipher = lib.SessionCipher || lib.sessioncipher || lib.default?.SessionCipher;
  const address = getAddress(lib, remoteUserId);
  const cipher = new SessionCipher(store, address);
  
  // 🛡️ FIX: Ensure ciphertextBundle is a Buffer if it arrives as Uint8Array
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

async sendMessage(remoteUserId, receiverModel = 'User', messageText) {
  const lib = libsignalModule.default || libsignalModule;
  const address = getAddress(lib, remoteUserId);

  const identityKeyPair = await store.getIdentityKeyPair();
  if (!identityKeyPair) {
    throw new Error("Identity Private Key missing! Please ensure you are logged in.");
  }
  
  let session = await store.loadSession(remoteUserId);

  if (!session) {
    console.log(`🔒 Establishing new session for ${remoteUserId}`);
    
    const response = await secureFetch(`/api/crypto/bundle/${remoteUserId}?model=${receiverModel}`);
    if (!response.ok) throw new Error("Could not fetch crypto bundle");
    
    const data = await response.json();
    if (!data.bundle) throw new Error("Bundle data missing from response");
    
    const preparedBundle = prepareBundleForSignal(data.bundle);
    
    const SessionBuilder = lib.SessionBuilder || lib.default?.SessionBuilder;
    if (!SessionBuilder) {
      throw new Error("SessionBuilder could not be found in libsignal module");
    }

    const sessionBuilder = new SessionBuilder(store, address);
    await sessionBuilder.initOutgoing(preparedBundle);
    
    session = await store.loadSession(remoteUserId);
    if (!session) {
      throw new Error("Critical: Session handshake completed but failed to persist.");
    }
  }

  const encrypted = await this.encrypt(remoteUserId, messageText);
  
  const response = await secureFetch('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      receiverId: remoteUserId,
      receiverModel: receiverModel,
      isEncrypted: true,
      payload: {
        ciphertext: encrypted.body,
        iv: encrypted.iv || '',
        ephemeralKey: encrypted.ephemeralKey || '',
        counter: encrypted.counter || 0,
        previousCounter: encrypted.previousCounter || 0,
        type: encrypted.type === 3 ? 'prekey' : 'message'
      },
      fileType: 'text'
    })
  });

  const result = await response.json();
  if (!result.success) throw new Error(result.message || "Transmission rejected.");
  
  return result;
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