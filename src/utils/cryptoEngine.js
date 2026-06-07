// =========================================================================
// 🔒 ZINGCONNECT SECURE END-TO-END CRYPTOGRAPHIC LAYER (MEMORY-ONLY)
// =========================================================================

/** * Helper: Converts raw binary array buffers to base64 strings 
 */
function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/** * Helper: Converts base64 strings back to binary array buffers 
 */
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

/**
 * 🔓 DECRYPT: Uses sender public key and OWN private key (passed from memory).
 */
export const decryptMessageText = async (cipherTextBase64, ivBase64, senderPublicKeyJwk, myPrivateKeyJwk) => {
  try {
    if (!ivBase64 || !senderPublicKeyJwk || !cipherTextBase64 || !myPrivateKeyJwk) {
      throw new Error("Missing parameters for decryption.");
    }

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

    const sharedSecretKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      { name: "AES-GCM", length: 256 },
      false, ["decrypt"]
    );

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
    return "🔒 [Encrypted Message - Decryption Failed]";
  }
};