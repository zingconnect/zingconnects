import { Buffer } from 'buffer';

export const bufferToBase64 = (buf) => {
  if (!buf) return "";
  // Ensure we are working with a Buffer, then convert to Base64 string
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return buffer.toString('base64');
};

export const toBuffer = (base64) => {
  if (!base64) return Buffer.alloc(0);
  // Directly convert Base64 string to Buffer
  return Buffer.from(base64, 'base64');
};

export const prepareBundleForSignal = (bundle) => {
  return {
    registrationId: parseInt(bundle.registrationId),
    identityKey: toBuffer(bundle.identityKey),
    signedPreKey: {
      keyId: bundle.signedPreKey.keyId,
      publicKey: toBuffer(bundle.signedPreKey.publicKey),
      signature: toBuffer(bundle.signedPreKey.signature),
    },
    preKey: bundle.preKey ? {
      keyId: bundle.preKey.keyId,
      publicKey: toBuffer(bundle.preKey.publicKey)
    } : (bundle.preKeys && bundle.preKeys.length > 0 ? {
      keyId: bundle.preKeys[0].keyId,
      publicKey: toBuffer(bundle.preKeys[0].publicKey)
    } : null)
  };
};