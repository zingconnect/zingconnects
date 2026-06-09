import { openDB } from 'idb';

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

  async isTrustedIdentity(identifier, identityKey, direction) {
    const savedKey = await this.loadIdentityKey(identifier);
    if (!savedKey) return true; // Trust on first use
        return areKeysEqual(savedKey, identityKey); 
  }

  async savePeerBundle(identifier, bundle) {
  const db = await dbPromise;
  // We store the bundle in the 'session' object store 
  // keyed by the peer's identifier (e.g., the agent's slug)
  await db.put('session', bundle, identifier);
}

async getPeerBundle(identifier) {
  const db = await dbPromise;
  return await db.get('session', identifier);
}

async saveIdentity(identifier, identityKey) {
  const db = await dbPromise;
  // If identityKey is an object with pubKey, extract it
  const rawKey = identityKey.pubKey || identityKey;
  
  // Convert to Base64 for consistent storage
  const base64Key = bufferToBase64(rawKey); 
  await db.put('identity', base64Key, identifier);
}

  async ensureReady() {
  await dbPromise; // Wait for the DB to be opened/upgraded
}

// --- IMPROVED IDENTITY LOADING ---
async loadIdentityKey(identifier) {
  await this.ensureReady();
  const db = await dbPromise;
  const base64Key = await db.get('identity', identifier);
  
  // Convert back to ArrayBuffer so libsignal can use it
  return base64Key ? toBuffer(base64Key) : null;
}
  // --- SESSIONS ---
  async saveSession(identifier, record) {
    const db = await dbPromise;
    await db.put('session', record, identifier);
  }

  async loadSession(identifier) {
    const db = await dbPromise;
    return (await db.get('session', identifier)) || null;
  }

  // --- REGISTRATION ---
  async getLocalRegistrationId() {
    const db = await dbPromise;
    return await db.get('misc', 'registrationId');
  }

  async saveRegistrationId(id) {
    const db = await dbPromise;
    await db.put('misc', id, 'registrationId');
  }
  
  // --- SIGNAL PROTOCOL INTERFACE ---
  async isTrustedIdentity(identifier, identityKey, direction) {
    const savedKey = await this.loadIdentityKey(identifier);
    if (!savedKey) return true; // Trust on first use
    return savedKey === identityKey; 
  }

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