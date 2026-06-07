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

function base64ToArrayBuffer(base64) {
  // 1. Sanitize for URL-safe base64 if needed
  const sanitized = base64.replace(/-/g, '+').replace(/_/g, '/');
  // 2. Decode using a Blob/FileReader pattern for true binary handling
  // Or use the standard method below:
  const binary_string = window.atob(sanitized);
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

export const decryptMessageText = async (cipherTextBase64, ivBase64, senderPublicKeyJwk, myPrivateKeyJwk) => {
  try {
    if (!ivBase64 || !senderPublicKeyJwk || !cipherTextBase64 || !myPrivateKeyJwk) {
      return "🔒 [Encrypted Message]";
    }

    // --- ADD LOG HERE: Verify the strings before conversion ---
    console.log("Decryption Debug:", { 
      cipherText: cipherTextBase64, 
      iv: ivBase64 
    });

    const iv = base64ToArrayBuffer(ivBase64);
    const data = base64ToArrayBuffer(cipherTextBase64);

    // --- ADD LOG HERE: Verify the resulting byte lengths ---
    console.log("Buffer Check:", { 
      ivByteLength: iv.byteLength, 
      dataByteLength: data.byteLength 
    });

   if (iv.byteLength !== 12) {
  console.warn("IV length mismatch. Expected 12, got:", iv.byteLength);
  return "🔒 [Encrypted Message - Key/IV Mismatch]";
}
    if (data.byteLength === 0) {
      throw new Error("Ciphertext data is empty");
    }

    const myPrivateKey = await window.crypto.subtle.importKey(
      "jwk", myPrivateKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]
    );
    const peerPublicKey = await window.crypto.subtle.importKey(
      "jwk", senderPublicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, true, []
    );

    const sharedSecretKey = await window.crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      { name: "AES-GCM", length: 256 },
      false, 
      ["decrypt"]
    );

    // --- ADD LOG HERE: Confirm key derivation success ---
    console.log("Shared secret derived successfully.");

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      sharedSecretKey,
      data
    );

    return new TextDecoder().decode(decryptedBuffer);
    
  } catch (err) {
    // This will now show the logs leading up to the failure in your browser console
    console.error("Decryption runtime error:", err);
    return "🔒 [Encrypted Message - Decryption Failed]";
  }
};