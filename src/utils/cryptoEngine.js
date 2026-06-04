// =========================================================================
// 🔒 ZINGCONNECT SECURE END-TO-END CRYPTOGRAPHIC LAYER (WEB CRYPTO API)
// =========================================================================
import { secureFetch } from "../../api/utils/api";

// Helper: Converts raw binary array buffers to base64 strings for DB storage
function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// Helper: Converts base64 strings back to binary array buffers for decryption
function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 🔑 GENERATE KEYPAIR: Runs locally on the client machine.
 * Stores the private key in localStorage, and ships the public key to MongoDB.
 */
export const initializeUserE2EEKeys = async (userId, token) => {
  const privateKeyName = `zing_secure_pk_${userId}`;
  
  // If this device already contains the private key, skip generation
  if (localStorage.getItem(privateKeyName)) {
    console.log("🔒 Identity keys verified locally.");
    return true;
  }

  try {
    console.log("🛡️ Generating new asymmetric ECDH keypair...");
    // 1. Generate an ECDH Key Pair on the secure P-256 Elliptic Curve
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true, 
      ["deriveKey", "deriveBits"]
    );

    // 2. Export keys to standard JSON Web Key (JWK) format
    const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

    // 3. Keep the Private Key strictly isolated inside this browser's Local Storage
    localStorage.setItem(privateKeyName, JSON.stringify(privateKeyJwk));

   // ⚡ CLEANER & SECURE: Swapped native fetch for your custom secureFetch utility
    const response = await secureFetch('/api/update-crypto-key', token, {
      method: 'PUT',
      body: JSON.stringify({ publicKeyJwk })
    });

    if (!response.ok) {
      throw new Error("Failed to register public cryptographic key with server.");
    }

    console.log("✅ E2EE Keys successfully synced with ZingConnect Protocol.");
    return true;
  } catch (err) {
    console.error("❌ E2EE Key Initialization Failed:", err);
    return false;
  }
};

/**
 * 🔒 ENCRYPT: Takes plaintext message string and recipient's public key.
 * Generates an AES-GCM shared key on-the-fly and returns the cipher text + IV.
 */
export const encryptMessageText = async (clearText, recipientPublicKeyJwk, myUserId) => {
  try {
    if (!recipientPublicKeyJwk) {
      // Fallback if the peer hasn't generated keys yet
      return { cipherText: clearText, iv: null, isEncrypted: false };
    }

    const rawSavedPrivate = JSON.parse(localStorage.getItem(`zing_secure_pk_${myUserId}`));
    if (!rawSavedPrivate) return { cipherText: clearText, iv: null, isEncrypted: false };

    // Import keys into standard subtle crypto engine structures
    const myPrivateKey = await window.crypto.subtle.importKey("jwk", rawSavedPrivate, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
    const peerPublicKey = await window.crypto.subtle.importKey("jwk", recipientPublicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);

    // Securely derive a shared symetric key locally (AES-GCM 256)
    const sharedSecretKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encodedText = new TextEncoder().encode(clearText);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      sharedSecretKey,
      encodedText
    );

    return {
      cipherText: arrayBufferToBase64(encryptedBuffer),
      iv: arrayBufferToBase64(iv),
      isEncrypted: true
    };
  } catch (e) {
    console.error("Encryption runtime failure:", e);
    return { cipherText: clearText, iv: null, isEncrypted: false };
  }
};
export const decryptMessageText = async (cipherTextBase64, ivBase64, senderPublicKeyJwk, myUserId) => {
  try {
    // 1. Validation
    if (!ivBase64 || !senderPublicKeyJwk || !cipherTextBase64) return cipherTextBase64;

    // 2. Retrieve Private Key
    const storageKey = `zing_secure_pk_${myUserId}`;
    console.log("🔍 Attempting to retrieve key with:", storageKey); // ADD THIS
    const rawSavedPrivate = localStorage.getItem(storageKey);
    
    if (!rawSavedPrivate) {
      console.error("Decryption failed: Private key not found in storage.");
      return "🔒 [Encrypted Message - Key Missing]";
    }

    const myPrivateKeyJwk = JSON.parse(rawSavedPrivate);

    // 3. Import Keys
    // Ensure the curves and names match your encryption setup perfectly
    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", myPrivateKeyJwk, 
      { name: "ECDH", namedCurve: "P-256" }, 
      false, ["deriveKey"]
    );

    const peerPublicKey = await window.crypto.subtle.importKey(
      "jwk", senderPublicKeyJwk, 
      { name: "ECDH", namedCurve: "P-256" }, 
      true, []
    );

    // 4. Derive Shared Secret
    const sharedSecretKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      { name: "AES-GCM", length: 256 },
      false, ["decrypt"]
    );

    // 5. Decrypt
    // Ensure you are passing the iv as a Uint8Array (AES-GCM requires 12 bytes)
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(cipherTextBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      sharedSecretKey,
      data
    );

    return new TextDecoder().decode(decryptedBuffer);

  } catch (err) {
    console.error("Decryption runtime error:", err);
    // Return a clear indicator so the UI knows to show a "failed to decrypt" icon
    return "🔒 [Encrypted Message - Decryption Failed]";
  }
};