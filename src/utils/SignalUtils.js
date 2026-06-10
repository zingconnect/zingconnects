// SignalUtils.js
export const bufferToBase64 = (buf) => {
  if (!buf) return "";
  // Ensure we are working with a Uint8Array
  const bytes = new Uint8Array(buf.buffer ? buf.buffer : buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const toBuffer = (base64) => {
  if (!base64) return new ArrayBuffer(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

// Helper to convert the entire bundle from Base64 (API format) to ArrayBuffer (Signal format)
export const prepareBundleForSignal = (bundle) => {
  return {
    registrationId: bundle.registrationId,
    identityKey: toBuffer(bundle.identityKey),
    signedPreKey: {
      keyId: bundle.signedPreKey.keyId,
      publicKey: toBuffer(bundle.signedPreKey.publicKey),
      signature: toBuffer(bundle.signedPreKey.signature),
    },
    preKey: bundle.preKeys && bundle.preKeys.length > 0 ? {
      keyId: bundle.preKeys[0].keyId,
      publicKey: toBuffer(bundle.preKeys[0].publicKey),
    } : null
  };
};