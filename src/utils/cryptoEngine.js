// =========================================================================
// 🔒 ZINGCONNECT SECURE END-TO-END CRYPTOGRAPHIC LAYER (MEMORY-ONLY)
// =========================================================================
import { secureFetch } from "../../api/utils/api";

/**
 * 🛠️ CONVERT: ArrayBuffer to Base64 (Safe)
 */
function arrayBufferToBase64(buffer) {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Use chunking for very large buffers to prevent stack overflow
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * 🛠️ CONVERT: Base64 to ArrayBuffer (Safe & Robust)
 */
function base64ToArrayBuffer(base64) {
  // 1. Critical Validation
  if (!base64 || typeof base64 !== 'string') {
    console.warn("base64ToArrayBuffer: Input is missing or not a string.");
    return new Uint8Array(0).buffer;
  }

  try {
    // 2. URL-safe Base64 to Standard Base64
    // Replace '-' with '+' and '_' with '/'
    let sanitized = base64.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if necessary (atob requires string length to be multiple of 4)
    while (sanitized.length % 4 !== 0) {
      sanitized += '=';
    }

    // 3. Decode
    const binary_string = window.atob(sanitized);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (err) {
    console.error("Base64 decoding failed. Ensure input is valid Base64.", err);
    return new Uint8Array(0).buffer;
  }
}

/**
 * 🔑 GENERATE KEYPAIR: Generates ECDH keys in memory.
 * Caller (AuthContext) is responsible for storing privateKeyJwk in React State.
 */
export const generateE2EEKeyPair = async () => {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true, 
      ["deriveKey", "deriveBits"]
    );

    const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

    return { publicKeyJwk, privateKeyJwk };
  } catch (err) {
    console.error("❌ E2EE Key Generation Failed:", err);
    return null;
  }
};

export const initializeUserE2EEKeys = async (userId) => {
  try {
    // 1. Generate the key pair in memory
    const keyPair = await generateE2EEKeyPair();
    if (!keyPair) throw new Error("Key generation failed");

    const res = await secureFetch('/api/update-crypto-key', {
      method: 'PUT',
      body: JSON.stringify({ 
        publicKeyJwk: keyPair.publicKeyJwk 
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Failed to register public key");
    }

    // 3. Return the keyPair so the UI can keep the private key in React state
    // (This follows your memory-only requirement)
    return keyPair; 
  } catch (err) {
    console.error("❌ Initialization error:", err);
    return null;
  }
};

/**
 * 🔒 ENCRYPT: Returns a structured payload object for the database.
 */
export const encryptMessageText = async (clearText, recipientPublicKeyJwk, myPrivateKeyJwk) => {
  try {
    if (!recipientPublicKeyJwk || !myPrivateKeyJwk) {
      throw new Error("Missing cryptographic keys for encryption.");
    }

    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", myPrivateKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]
    );
    const peerPublicKey = await window.crypto.subtle.importKey(
      "jwk", recipientPublicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, true, []
    );

    const sharedSecretKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      sharedSecretKey,
      new TextEncoder().encode(clearText)
    );

    return {
      payload: {
        ciphertext: arrayBufferToBase64(encryptedBuffer),
        iv: arrayBufferToBase64(iv),
        version: 1
      },
      isEncrypted: true
    };
  } catch (e) {
    console.error("Encryption runtime failure:", e);
    return { text: clearText, isEncrypted: false };
  }
};

export const decryptMessageText = async (payload, senderPublicKeyJwk, myPrivateKeyJwk) => {
  try {
    // 1. Pre-validation: Stop if keys are missing
    if (!myPrivateKeyJwk || !senderPublicKeyJwk) {
      throw new Error("Decryption keys are missing/null.");
    }

    // 2. Destructure and prepare keys
    const privKeyObj = typeof myPrivateKeyJwk === 'string' ? JSON.parse(myPrivateKeyJwk) : myPrivateKeyJwk;
    const pubKeyObj = typeof senderPublicKeyJwk === 'string' ? JSON.parse(senderPublicKeyJwk) : senderPublicKeyJwk;

    // 3. Robust Sanitize: Ensure object has required fields
    const sanitize = (jwk) => {
      if (!jwk || typeof jwk !== 'object') throw new Error("Invalid JWK format");
      return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d, ext: true };
    };

    const sanitizedPriv = sanitize(privKeyObj);
    const sanitizedPub = sanitize(pubKeyObj);

    // 4. Proceed with decryption...
    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", sanitizedPriv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]
    );
    // ... rest of your existing logic
  } catch (err) {
    console.error("Decryption runtime error:", err);
    return "🔒 [Decryption Failed]";
  }
};