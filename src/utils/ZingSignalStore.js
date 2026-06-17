import { openDB } from 'idb';
import { bufferToBase64, toBuffer } from './SignalUtils'; 

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
  constructor(lib) {
    this.lib = lib;
  }

_getKey(identifier, deviceId, type, remoteUserId = '') {
  return `${identifier}_${deviceId}_${type}_${remoteUserId}`;
}
  async ensureReady() { await dbPromise; }

  // --- IDENTITY ---
  async saveIdentity(identifier, identityKey, deviceId) {
    if (!identifier || !deviceId) throw new Error("Missing identifier or deviceId");
    
    const db = await dbPromise;
    const rawKey = identityKey.pubKey || identityKey;
    const base64Key = bufferToBase64(rawKey);
    
    await db.put('identity', base64Key, this._getKey(identifier, deviceId, 'identity'));
  }
  
async loadIdentity(identifier, deviceId) {
  await this.ensureReady();
  const db = await dbPromise;
    const identityObj = await db.get('identity', this._getKey(identifier, deviceId, 'identity'));
  
  if (!identityObj) return null;
  return {
    ...identityObj,
    keyPair: {
      pubKey: toBuffer(identityObj.keyPair.pubKey),
      privKey: toBuffer(identityObj.keyPair.privKey)
    }
  };
}

  // --- REGISTRATION ---
  async saveRegistrationId(identifier, id, deviceId) {
    const db = await dbPromise;
    await db.put('misc', id, this._getKey(identifier, deviceId, 'regId'));
  }

  async getLocalRegistrationId(identifier, deviceId) {
    const db = await dbPromise;
    return await db.get('misc', this._getKey(identifier, deviceId, 'regId'));
  }

// --- SESSIONS ---
async saveSession(identifier, remoteUserId, record, deviceId) {
  const db = await dbPromise;
  const data = record.serialize();
  // FIX: Include deviceId here to match loadSession
  await db.put('session', data, this._getKey(identifier, deviceId, 'session', remoteUserId));
}

async loadSession(identifier, remoteUserId, deviceId) {
  await this.ensureReady();
  const db = await dbPromise;
  // This looks correct now
  const record = await db.get('session', this._getKey(identifier, deviceId, 'session', remoteUserId));
  
  if (!record) return null;
  try {
    return this.lib.SessionRecord.deserialize(record);
  } catch (err) {
    // FIX: Include remoteUserId in the delete call as well
    await db.delete('session', this._getKey(identifier, deviceId, 'session', remoteUserId));
    return null;
  }
}

  // --- PREKEYS ---
  async savePreKey(identifier, keyId, keyPair, deviceId) {
    if (!identifier || !deviceId) throw new Error("Missing identifier or deviceId");
    const db = await dbPromise;
    await db.put('prekeys', keyPair, this._getKey(identifier, deviceId, `pk_${keyId}`));
  }

  async loadPreKey(identifier, keyId, deviceId) {
    const db = await dbPromise;
    return await db.get('prekeys', this._getKey(identifier, deviceId, `pk_${keyId}`));
  }

  async removePreKey(identifier, keyId, deviceId) {
    const db = await dbPromise;
    await db.delete('prekeys', this._getKey(identifier, deviceId, `pk_${keyId}`));
  }

async getOrGenerateDeviceId() {
  const db = await dbPromise;
  let deviceId = await db.get('misc', 'current_device_id');
  
  if (!deviceId) {
    deviceId = Math.floor(Math.random() * 1000000).toString();
    await db.put('misc', deviceId, 'current_device_id');
  }
  return String(deviceId); // Ensure it's always a string
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