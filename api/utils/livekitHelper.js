import * as LiveKitSDK from 'livekit-server-sdk';

export const createLiveKitToken = async (roomName, identity) => {
  const room = String(roomName).trim();
  const user = String(identity).trim();

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("SERVER_CONFIG_ERROR: LiveKit keys missing in process.env");
  }

  try {
    // 💡 AccessToken is often a property of the main export in ESM
    const AccessToken = LiveKitSDK.AccessToken; 
    
    if (!AccessToken) {
      throw new Error("AccessToken constructor not found in LiveKit SDK");
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: user,
      ttl: '2h', 
    });

    at.addGrant({
      roomJoin: true,
      room: room,
      canPublish: true,      
      canSubscribe: true,    
    });

    const token = await at.toJwt();
    if (!token) throw new Error("Generated token was empty");

    return token;
  } catch (error) {
    console.error("[LiveKit] JWT Generation Failed:", error.message);
    throw error; 
  }
};