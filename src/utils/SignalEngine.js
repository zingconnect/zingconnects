import * as libsignal from 'libsignal';
import { ZingSignalStore } from './ZingSignalStore';

const store = new ZingSignalStore();

/**
 * 🔒 ZINGCONNECT SIGNAL ENGINE
 * Implements the Signal Protocol for E2EE messaging.
 */

// Implementation of the Signal Protocol Store
// You should use 'idb' or 'localForage' to persist these in IndexedDB
class ZingSignalStore {
  constructor() {
    this.storage = new Map(); // Replace this with actual IndexedDB calls
  }

  async get(key, defaultValue) {
    const value = this.storage.get(key);
    return value !== undefined ? value : defaultValue;
  }

  async saveIdentity(identifier, identityKey) {
    this.storage.set(`identity:${identifier}`, identityKey);
  }

  async loadIdentityKey(identifier) {
    return this.storage.get(`identity:${identifier}`);
  }

  async saveSession(identifier, record) {
    this.storage.set(`session:${identifier}`, record);
  }

  async loadSession(identifier) {
    return this.storage.get(`session:${identifier}`);
  }

  // Required for libsignal to track registration state
  async getLocalRegistrationId() {
    return await this.get("registrationId", Math.floor(Math.random() * 16380));
  }
}

const store = new ZingSignalStore();

/**
 * 1. Initialize a Session (X3DH Handshake)
 * @param {string} remoteUserId - The ID of the Agent/User
 * @param {object} preKeyBundle - The bundle fetched from your /api/crypto/bundle/:userId
 */
export const initializeSession = async (remoteUserId, preKeyBundle) => {
  try {
    const sessionBuilder = new libsignal.SessionBuilder(store, remoteUserId);
    
    // The bundle MUST match the structure libsignal expects:
    // { identityKey, signedPreKey, preKeyId, preKeyPublic, registrationId }
    await sessionBuilder.processPreKey(preKeyBundle);
    console.log(`✅ Session initialized with user: ${remoteUserId}`);
  } catch (error) {
    console.error("❌ Handshake failed:", error);
    throw new Error("Failed to establish secure session.");
  }
};

/**
 * 2. Encrypt (Double Ratchet)
 * @param {string} remoteUserId 
 * @param {string} clearText 
 * @returns {Promise<object>} { type: number, body: string }
 */
export const encryptMessage = async (remoteUserId, clearText) => {
  const sessionCipher = new libsignal.SessionCipher(store, remoteUserId);
  const encrypted = await sessionCipher.encrypt(new TextEncoder().encode(clearText));
  
  // Returns structure: { type: 3, body: "base64_string" }
  return encrypted;
};

/**
 * 3. Decrypt (Double Ratchet)
 * @param {string} remoteUserId 
 * @param {object} ciphertext - The object returned by encryptMessage
 */
export const decryptMessage = async (remoteUserId, ciphertext) => {
  try {
    const sessionCipher = new libsignal.SessionCipher(store, remoteUserId);
    const decrypted = await sessionCipher.decrypt(ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error("❌ Decryption failed. Possible out-of-order message or tampering.");
    throw error;
  }
};