import { openDB } from 'idb';

const DB_NAME = 'ZingConnectCrypto';
const STORE_NAME = 'keys';

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  },
});

export const savePeerPublicKey = async (slug, key) => {
  const db = await dbPromise;
  // We use a unique key name based on the agent's slug
  await db.put(STORE_NAME, key, `peer_pub_${slug}`);
};

export const getPeerPublicKey = async (slug) => {
  const db = await dbPromise;
  return await db.get(STORE_NAME, `peer_pub_${slug}`);
};

// Store the full Double Ratchet Session State
export const saveSessionState = async (slug, sessionState) => {
  const db = await dbPromise;
  await db.put(STORE_NAME, sessionState, `session_${slug}`);
};

export const getSessionState = async (slug) => {
  const db = await dbPromise;
  return await db.get(STORE_NAME, `session_${slug}`);
};

export const savePrivateKey = async (key) => {
  const db = await dbPromise;
  await db.put(STORE_NAME, key, 'my_private_key');
};

export const getPrivateKey = async () => {
  const db = await dbPromise;
  return await db.get(STORE_NAME, 'my_private_key');
};

export const clearKeys = async () => {
  const db = await dbPromise;
  await db.clear(STORE_NAME);
};