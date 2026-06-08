/**
 * 🔒 ZINGCONNECT E2EE ENGINE (Signal-Protocol Foundation)
 * This structure facilitates the transition from manual ECDH to 
 * X3DH-based Session management.
 */

export const generateIdentityKeyPair = async () => {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // extractable
    ["deriveKey"]
  );
  return keyPair; // Return the CryptoKeyPair object directly
};


/**
 * Orchestrates the generation of new identity keys and saves them to storage.
 */
export const initializeUserE2EEKeys = async () => {
  // 1. Generate new KeyPair using the existing logic
  const { publicKeyJwk, privateKeyJwk } = await generateIdentityKeyPair();
  
  // 2. Import the storage methods
  // Note: We perform the import inside the function or at the top level 
  // to save the private key to indexedDB via your storage utility
  const { savePrivateKey } = await import("./cryptoStorage");

  // 3. Persist the private key
  await savePrivateKey(privateKeyJwk);
  
  // 4. Return the public key to be sent to your backend/API
  return { publicKeyJwk };
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


export const encryptMessageText = async (clearText, publicKeyJwk, privateKeyJwk) => {
  // 1. Import keys
  const pub = await importPublicKey(publicKeyJwk);
  const priv = await importPublicKey(privateKeyJwk);
  
  // 2. Derive shared secret (ECDH)
  const sharedSecret = await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: pub },
    priv,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  // 3. Encrypt
  const { ciphertext, iv } = await encryptForTransport(clearText, sharedSecret);
  
  return { cipherText: ciphertext, iv, isEncrypted: true };
};

export const decryptMessageText = async (payload, senderPublicKeyJwk, privateKeyJwk) => {
  // 1. Import keys
  const senderPub = await importPublicKey(senderPublicKeyJwk);
  const priv = await importPublicKey(privateKeyJwk);
  
  // 2. Derive shared secret
  const sharedSecret = await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: senderPub },
    priv,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  // 3. Decrypt
  return await decryptMessage(payload, sharedSecret);
};