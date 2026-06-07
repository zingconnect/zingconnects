// =========================================================================
// 🔒 ZINGCONNECT SECURE END-TO-END CRYPTOGRAPHIC LAYER (MEMORY-ONLY)
// =========================================================================

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Replacement for your current base64ToArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary_string = window.atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer; // Returning the buffer directly
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

/**
 * 🔒 ENCRYPT: Uses recipient public key and OWN private key (passed from memory).
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

export const decryptMessageText = async (cipherTextBase64, ivBase64, senderPublicKeyJwk, myPrivateKeyJwk) => {
  try {
    // 1. Sanitize JWK: Ensure we are only passing standard JWK properties
    const sanitize = (jwk) => ({
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      d: jwk.d,
      ext: true
    });

    // Ensure we are working with objects, not strings
    const privKeyObj = typeof myPrivateKeyJwk === 'string' ? JSON.parse(myPrivateKeyJwk) : myPrivateKeyJwk;
    const pubKeyObj = typeof senderPublicKeyJwk === 'string' ? JSON.parse(senderPublicKeyJwk) : senderPublicKeyJwk;

    // 2. Validate IV and Data
    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(cipherTextBase64);

    if (iv.byteLength !== 12) {
      console.warn("IV length mismatch. Expected 12, got:", iv.byteLength);
      return "🔒 [Decryption Failed - IV]";
    }

    // 3. Import with Sanitized Objects
    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", sanitize(privKeyObj), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]
    );
    const peerPublicKey = await window.crypto.subtle.importKey(
      "jwk", sanitize(pubKeyObj), { name: "ECDH", namedCurve: "P-256" }, true, []
    );

    // 4. Derivation and Decryption
    const sharedSecretKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      { name: "AES-GCM", length: 256 },
      false, 
      ["decrypt"]
    );

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      sharedSecretKey,
      data
    );

    return new TextDecoder().decode(decryptedBuffer);
    
  } catch (err) {
    console.error("Decryption runtime error:", err);
    return "🔒 [Decryption Failed]";
  }
};