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

  _getKey(key, deviceId) {
    return deviceId ? `${key}_${deviceId}` : key;
  }

  set lib(value) { this._lib = value; }
  get lib() {
    if (!this._lib) console.error(`ZingSignalStore: libsignal undefined.`);
    return this._lib;
  }

  async ensureReady() { await dbPromise; }

  // --- IDENTITY ---
  async saveIdentityKeyPair(identityKeyPair, deviceId) {
    const db = await dbPromise;
    const tx = db.transaction(['identity'], 'readwrite');
    await tx.objectStore('identity').put(identityKeyPair.pubKey, this._getKey('local_pub', deviceId));
    await tx.objectStore('identity').put(identityKeyPair.privKey, this._getKey('local_priv', deviceId));
    await tx.done;
  }

  async getIdentityKeyPair(deviceId) {
    const db = await dbPromise;
    const pubKey = await db.get('identity', this._getKey('local_pub', deviceId));
    const privKey = await db.get('identity', this._getKey('local_priv', deviceId));
    return (pubKey && privKey) ? { pubKey, privKey } : null;
  }

  async saveIdentity(identifier, identityKey, deviceId) {
    const db = await dbPromise;
    const rawKey = identityKey.pubKey || identityKey;
    const base64Key = bufferToBase64(rawKey);
    // Identifier here usually refers to the remote peer's ID, 
    // so we don't necessarily need deviceId unless it's for local identity
    await db.put('identity', base64Key, identifier);
  }

  async loadIdentity(identifier) {
    await this.ensureReady();
    const db = await dbPromise;
    const base64Key = await db.get('identity', identifier);
    return base64Key ? toBuffer(base64Key) : null;
  }

  // --- REGISTRATION ---
  async saveRegistrationId(id, deviceId) {
    const db = await dbPromise;
    await db.put('misc', id, this._getKey('registrationId', deviceId));
  }

  async getLocalRegistrationId(deviceId) {
    const db = await dbPromise;
    return await db.get('misc', this._getKey('registrationId', deviceId));
  }

  // --- SESSIONS ---
  // Sessions are usually indexed by remote user ID, but if you want 
  // multi-device support for the SAME remote user, append deviceId to identifier
  async saveSession(identifier, record, deviceId) {
    const db = await dbPromise;
    const data = record.serialize();
    await db.put('session', data, this._getKey(identifier, deviceId));
  }

  async loadSession(identifier, deviceId) {
    const db = await dbPromise;
    const record = await db.get('session', this._getKey(identifier, deviceId));
    if (!record) return null;
    try {
      return this.lib.SessionRecord.deserialize(record);
    } catch (err) {
      await db.delete('session', this._getKey(identifier, deviceId));
      return null;
    }
  }

  // --- PREKEYS ---
  async saveSignedPreKey(keyId, keyPair, deviceId) {
    const db = await dbPromise;
    await db.put('prekeys', keyPair, this._getKey(keyId, deviceId));
  }

  async loadSignedPreKey(keyId, deviceId) {
    const db = await dbPromise;
    return await db.get('prekeys', this._getKey(keyId, deviceId));
  }

  async savePreKey(keyId, keyPair, deviceId) {
    const db = await dbPromise;
    await db.put('prekeys', keyPair, this._getKey(keyId, deviceId));
  }

  async loadPreKey(keyId, deviceId) {
    const db = await dbPromise;
    return await db.get('prekeys', this._getKey(keyId, deviceId));
  }

  async removePreKey(keyId, deviceId) {
    const db = await dbPromise;
    await db.delete('prekeys', this._getKey(keyId, deviceId));
  }

  async savePreKey(keyId, keyPair, deviceId) {
  if (!deviceId) throw new Error("CRITICAL: DeviceID missing in savePreKey");
  const db = await dbPromise;
  await db.put('prekeys', keyPair, this._getKey(keyId, deviceId));
}
  
async getOrGenerateDeviceId() {
  const db = await dbPromise;
  let deviceId = await db.get('misc', 'current_device_id');
  
  if (!deviceId) {
    deviceId = Math.floor(Math.random() * 1000000).toString();
    await db.put('misc', deviceId, 'current_device_id');
  }
  return deviceId;
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