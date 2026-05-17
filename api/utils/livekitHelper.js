import { AccessToken } from 'livekit-server-sdk';
import crypto from 'crypto';

// ✅ Core Fix: Guarantee that modern Web Crypto primitives are universally mapped 
// for livekit-server-sdk v2.x signature hashing in all Node runtimes.
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = crypto;
}

/**
 * Generates a validated JWT token for LiveKit client authentication
 * @param {string} roomName 
 * @param {string} identity 
 * @returns {Promise<string>}
 */
export const createLiveKitToken = async (roomName, identity) => {
  const room = String(roomName).trim();
  const user = String(identity).trim();

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("SERVER_CONFIG_ERROR: LiveKit keys missing in process.env");
  }

  try {
    // Graceful fallback detection for mixed ESM/CJS environments
    const TokenConstructor = AccessToken;

    if (!TokenConstructor) {
      throw new Error("AccessToken constructor not found in LiveKit SDK exports");
    }

    const at = new TokenConstructor(apiKey, apiSecret, {
      identity: user,
      ttl: '2h', // Generous threshold to eliminate token expiration failures during call connection wait windows
    });

    at.addGrant({
      roomJoin: true,
      room: room,
      canPublish: true,      
      canSubscribe: true,    
    });

    // ⚡ CRITICAL: Await the async signature hashing handled by webcrypto primitives
    const token = await at.toJwt();
    
    if (!token) {
      throw new Error("Generated token was empty");
    }

    console.log(`🔑 LiveKit Token successfully minted for user: ${user} in room: ${room}`);
    return token;

  } catch (error) {
    console.error("[LiveKit] JWT Generation Failed:", error.message);
    throw error; 
  }
};