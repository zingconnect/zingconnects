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


export class ZingSignalStore {

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

  // --- IDENTITY KEYS ---
  async saveIdentity(identifier, identityKey) {
    const db = await dbPromise;
    await db.put('identity', identityKey, identifier);
  }

  async ensureReady() {
  await dbPromise; // Wait for the DB to be opened/upgraded
}

 async loadIdentityKey(identifier) {
  await this.ensureReady(); // Add this to every public method
  const db = await dbPromise;
  return await db.get('identity', identifier);
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