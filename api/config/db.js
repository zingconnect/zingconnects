import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { 
    conn: null, 
    promise: null,
    isUsingReserve: false 
  };
}

const commonOpts = {
  maxPoolSize: 100,
  minPoolSize: 20,
  serverSelectionTimeoutMS: 5000, 
  socketTimeoutMS: 45000,
  family: 4,
  bufferCommands: false,           // Stop the 10s buffering hang
  autoIndex: false,                // Recommended for production/Vercel
  connectTimeoutMS: 10000,         // Give the initial handshake enough time
};
/**
 * Main Connection Handler with Reserve Failover
 * This maintains your project structure while protecting against Free-Tier limits.
 */
export async function connectToDatabase() {
  // 1. If we already have a healthy connection, use it
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // 2. If a connection is already in progress, wait for it
  if (cached.promise) {
    return await cached.promise;
  }

  // 3. Define the connection attempt
  const attemptConnection = async () => {
    try {
      console.log("📡 Attempting connection to PRIMARY AGENT DB...");
      const primaryConn = await mongoose.connect(process.env.AGENT_DB_URI, commonOpts);
      cached.isUsingReserve = false;
      console.log("✅ ZingConnect: Primary Agent DB Active");
      return primaryConn;
    } catch (primaryError) {
      console.error("⚠️ Primary DB is FULL or Lagging. Switching to RESERVE...");
      
      try {
        const reserveConn = await mongoose.connect(process.env.USER_DB_URI, commonOpts);
        cached.isUsingReserve = true;
        console.log("🚀 ZingConnect: Running on RESERVE Cluster (USER_DB_URI)");
        return reserveConn;
      } catch (reserveError) {
        console.error("❌ CRITICAL: Both Primary and Reserve Databases failed.");
        throw new Error("No database available to handle the request.");
      }
    }
  };

  cached.promise = attemptConnection();
  
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // Reset promise so we can retry on next request
    return null;
  }

  return cached.conn;
}
