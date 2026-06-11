import { openDB } from 'idb';
import { bufferToBase64, toBuffer } from './SignalUtils'; 
import * as libsignalModule from 'libsignal';

const DB_NAME = 'ZingConnectStorage';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('identity')) db.createObjectStore('identity');
    if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
    if (!db.objectStoreNames.contains('prekeys')) db.createObjectStore('prekeys');
    if (!db.objectStoreNames.contains('misc')) db.createObjectStore('misc');
  },
});

const areKeysEqual = (key1, key2) => {
  // If they are buffers, compare their bytes
  if (key1 instanceof ArrayBuffer && key2 instanceof ArrayBuffer) {
    const b1 = new Uint8Array(key1);
    const b2 = new Uint8Array(key2);
    if (b1.length !== b2.length) return false;
    for (let i = 0; i < b1.length; i++) if (b1[i] !== b2[i]) return false;
    return true;
  }
  // Otherwise default to standard comparison
  return key1 === key2;
};

export class ZingSignalStore {
  constructor(lib) {
    this.lib = lib; 
  }

  async ensureReady() {
    await dbPromise; // Wait for the DB to be opened/upgraded
  }

async getIdentityKey(identifier) {
    return await this.loadIdentity(identifier);
  }

  async getIdentityKeyPair() {
  try {
    const db = await dbPromise; // Access the DB via the promise
        const pubKeyBase64 = await db.get('identity', 'local');
    const privKey = await db.get('identity', 'local_priv');

    if (!pubKeyBase64 || !privKey) {
      throw new Error("Identity keys (pub/priv) missing in IndexedDB.");
    }

    // 2. Return the pair in the format libsignal expects
    // We use the 'lib' instance passed during store initialization
    return {
      pubKey: this.lib.Curve.decodePoint(toBuffer(pubKeyBase64)),
      privKey: privKey // Already an ArrayBuffer from storage
    };
  } catch (err) {
    console.error("❌ Error in getIdentityKeyPair:", err.message);
    return null;
  }
}

  async isTrustedIdentity(identifier, identityKey, direction) {
    const savedKey = await this.loadIdentityKey(identifier);
    if (!savedKey) return true; // Trust on first use
    return areKeysEqual(savedKey, identityKey); 
  }

  async getOurIdentity() {
  return await this.loadIdentity('local');
}

  async saveIdentity(identifier, identityKey) {
    const db = await dbPromise;
    // Extract pubKey if it's an object, otherwise use the key directly
    const rawKey = identityKey.pubKey || identityKey;
    // Convert to Base64 for consistent storage
    const base64Key = bufferToBase64(rawKey); 
    await db.put('identity', base64Key, identifier);
  }

  async loadIdentity(identifier) {
    await this.ensureReady();
    const db = await dbPromise;
    const base64Key = await db.get('identity', identifier);
    return base64Key ? toBuffer(base64Key) : null;
  }

  async loadIdentityKey(identifier) {
    return await this.loadIdentity(identifier);
}

  // --- SESSIONS & BUNDLES ---
  async savePeerBundle(identifier, bundle) {
    const db = await dbPromise;
    await db.put('session', bundle, identifier);
  }

  async getPeerBundle(identifier) {
    const db = await dbPromise;
    return await db.get('session', identifier);
  }

async saveSession(identifier, record) {
  const db = await dbPromise;
  console.log(`DEBUG: Saving session for: ${identifier}`);
  const data = record.serialize(); 
  await db.put('session', data, identifier);
}

async loadSession(identifier) {
  const db = await dbPromise;
  const data = await db.get('session', identifier);
  
  console.log(`DEBUG: Attempting to load session for: ${identifier}, Found: ${!!data}`);
  
  if (!data) return null;
    return this.lib.SessionRecord.deserialize(data);
}

  async getLocalRegistrationId() {
    const db = await dbPromise;
    return await db.get('misc', 'registrationId');
  }

  async loadSignedPreKey(keyId) {
    const db = await dbPromise;
    return await db.get('prekeys', keyId);
  }

  async saveSignedPreKey(keyId, keyPair) {
    const db = await dbPromise;
    await db.put('prekeys', keyPair, keyId);
  }

async saveIdentityKeyPair(identityKeyPair) {
  const db = await dbPromise;
  const tx = db.transaction(['identity'], 'readwrite');
    const pubKeyBase64 = bufferToBase64(identityKeyPair.pubKey);
  await tx.objectStore('identity').put(pubKeyBase64, 'local');
    await tx.objectStore('identity').put(identityKeyPair.privKey, 'local_priv');
  
  await tx.done;
}

  async saveRegistrationId(id) {
    const db = await dbPromise;
    await db.put('misc', id, 'registrationId');
  }
  
  // --- PREKEYS ---
  async loadPreKey(keyId) {
    const db = await dbPromise;
    return await db.get('prekeys', keyId);
  }

  async savePreKey(keyId, keyPair) {
    const db = await dbPromise;
    await db.put('prekeys', keyPair, keyId);
  }

  async removePreKey(keyId) {
    const db = await dbPromise;
    await db.delete('prekeys', keyId);
  }

  async clearAll() {
    const db = await dbPromise;
    const tx = db.transaction(['identity', 'session', 'prekeys', 'misc'], 'readwrite');
    await Promise.all([
      tx.objectStore('identity').clear(),
      tx.objectStore('session').clear(),
      tx.objectStore('prekeys').clear(),
      tx.objectStore('misc').clear()
    ]);
    await tx.done;
  }
}