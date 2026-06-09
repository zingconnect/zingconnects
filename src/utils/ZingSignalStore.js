import { openDB } from 'idb';
import * as libsignalModule from 'libsignal';

// Resolve the module and map the exports exactly as your console logs require
const libsignal = libsignalModule.default || libsignalModule;
const KeyHelper = libsignal.keyhelper || libsignal.KeyHelper;

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
    db.createObjectStore('misc');
  },
});

export class ZingSignalStore {
  async saveIdentity(identifier, identityKey) {
    const db = await dbPromise;
    await db.put('identity', identityKey, identifier);
  }

  async loadIdentityKey(identifier) {
    const db = await dbPromise;
    return await db.get('identity', identifier);
  }

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
      // KeyHelper is now correctly mapped
      id = KeyHelper.generateRegistrationId(); 
      await db.put('misc', id, 'registrationId');
    }
    return id;
  }

  async saveRegistrationId(id) {
    const db = await dbPromise;
    await db.put('misc', id, 'registrationId');
  }
  
  async isTrustedIdentity(identifier, identityKey, direction) {
    return true; 
  }

  async savePeerPublicKey(identifier, key) {
    const db = await dbPromise;
    await db.put('identity', key, `peer:${identifier}`);
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