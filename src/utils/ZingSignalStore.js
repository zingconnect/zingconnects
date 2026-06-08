import { openDB } from 'idb';

/**
 * 🔒 ZINGSIGNALSTORE
 * Handles persistent storage of IdentityKeys, Sessions, and PreKeys in IndexedDB.
 */
const DB_NAME = 'ZingConnectStorage';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    db.createObjectStore('identity');
    db.createObjectStore('session');
    db.createObjectStore('prekeys');
    db.createObjectStore('misc'); // For registrationId, etc.
  },
});

export class ZingSignalStore {
  // --- IDENTITY KEYS ---
  async saveIdentity(identifier, identityKey) {
    const db = await dbPromise;
    await db.put('identity', identityKey, identifier);
  }

  async loadIdentityKey(identifier) {
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
    return await db.get('session', identifier);
  }

 async getLocalRegistrationId() {
  const db = await dbPromise;
  let id = await db.get('misc', 'registrationId');
  if (!id) {
    // Use the official Signal helper
    id = libsignal.KeyHelper.generateRegistrationId(); 
    await db.put('misc', id, 'registrationId');
  }
  return id;
}
  // --- TRUSTED IDENTITIES ---
  // In a production app, verify keys against your server's database 
  // or via QR code scanning.
  async isTrustedIdentity(identifier, identityKey, direction) {
    // For now, we trust. In production, check against stored identity.
    return true; 
  }

  // --- REQUIRED BY LIBSIGNAL ---
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
}