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

// Add this inside the ZingSignalStore class in ZingSignalStore.js
async savePeerBundle(slug, bundle) {
  const db = await dbPromise;
  // Use the slug as the key to retrieve this peer's keys later
  await db.put('identity', bundle, `peer_bundle:${slug}`);
}

async loadIdentityKey(identifier) {
  const db = await dbPromise;
  const key = await db.get('identity', identifier);
  return key || null;
}

  async saveSession(identifier, record) {
    const db = await dbPromise;
    await db.put('session', record, identifier);
  }

  async containsSession(identifier) {
    const db = await dbPromise;
    return !!(await db.get('session', identifier));
  }

 async loadSession(identifier) {
  const db = await dbPromise;
  const session = await db.get('session', identifier);
  return session || null; // MUST return null if not found, not undefined
}

 async loadRegistrationId(identifier) {
  const db = await dbPromise;
  return await db.get('misc', `regId:${identifier}`);
}

 async saveRegistrationIdForPeer(identifier, id) {
  const db = await dbPromise;
  await db.put('misc', id, `regId:${identifier}`);
}
  
 async isTrustedIdentity(identifier, identityKey, direction) {
    const savedKey = await this.loadIdentityKey(identifier);
    return savedKey === identityKey; 
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