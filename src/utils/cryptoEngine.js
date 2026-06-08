/**
 * 🔒 ZINGCONNECT E2EE ENGINE (Signal-Protocol Foundation)
 * This structure facilitates the transition from manual ECDH to 
 * X3DH-based Session management.
 */

// 1. IDENTITY & KEY MANAGEMENT
// Generates a robust JWK KeyPair for the Identity Key
export const generateIdentityKeyPair = async () => {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  
  const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  
  return { publicKeyJwk, privateKeyJwk, keyPair };
};

// 2. SESSION LAYER (The Handshake Foundation)
// Imports keys into WebCrypto for the X3DH calculation
export const importPublicKey = async (jwk) => {
  return await window.crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []
  );
};

// 3. SECURE TRANSPORT (AEAD)
// Using AES-GCM as the industry standard for AEAD (Authenticated Encryption)
export const encryptForTransport = async (clearText, derivedMessageKey) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  // We expect derivedMessageKey to be a CryptoKey object (importKey result)
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    derivedMessageKey,
    new TextEncoder().encode(clearText)
  );
  
  return { 
    ciphertext: encryptedBuffer, 
    iv 
  };
};

// 4. DECRYPTION (With Integrity Protection)
export const decryptMessage = async (payload, messageKey) => {
  try {
    // payload.ciphertext is the ArrayBuffer
    // payload.iv is the 12-byte ArrayBuffer
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: payload.iv },
      messageKey,
      payload.ciphertext
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.error("Decryption failed. Authentication tag mismatch or wrong key.");
    throw new Error("Integrity check failed.");
  }
};