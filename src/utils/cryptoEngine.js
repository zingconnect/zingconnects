// =========================================================================
// 🔒 ZINGCONNECT SECURE END-TO-END CRYPTOGRAPHIC LAYER (MEMORY-ONLY)
// =========================================================================

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
 * 🛠️ CONVERT: Base64 to ArrayBuffer (Safe)
 */
function base64ToArrayBuffer(base64) {
  // 1. Critical Validation
  if (!base64 || typeof base64 !== 'string') {
    console.error("base64ToArrayBuffer received invalid input:", base64);
    return new Uint8Array(0).buffer;
  }

  // 2. Cleanup and Decode
  try {
    const sanitized = base64.replace(/-/g, '+').replace(/_/g, '/');
    const binary_string = window.atob(sanitized);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (err) {
    console.error("Base64 decoding failed:", err);
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

/**
 * 🔑 DECRYPT: Accepts the database 'payload' object.
 */
export const decryptMessageText = async (payload, senderPublicKeyJwk, myPrivateKeyJwk) => {
  try {
    // 1. Destructure payload
    const { ciphertext, iv: ivBase64 } = payload;
    
    // 2. Validate IV
    const iv = base64ToArrayBuffer(ivBase64);
    if (iv.byteLength !== 12) throw new Error("Invalid IV length");

    // 3. Sanitize keys
    const sanitize = (jwk) => ({
      kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d, ext: true
    });

    const privKeyObj = typeof myPrivateKeyJwk === 'string' ? JSON.parse(myPrivateKeyJwk) : myPrivateKeyJwk;
    const pubKeyObj = typeof senderPublicKeyJwk === 'string' ? JSON.parse(senderPublicKeyJwk) : senderPublicKeyJwk;

    // 4. Import keys
    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", sanitize(privKeyObj), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]
    );
    const peerPublicKey = await window.crypto.subtle.importKey(
      "jwk", sanitize(pubKeyObj), { name: "ECDH", namedCurve: "P-256" }, true, []
    );

    // 5. Derive and Decrypt
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
      base64ToArrayBuffer(ciphertext)
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.error("Decryption runtime error:", err);
    return "🔒 [Decryption Failed]";
  }
};