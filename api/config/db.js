import mongoose from 'mongoose';

// 🛡️ Ensure Mongoose queues operations during connection transitions
// This specifically resolves "Cannot call findOne() before initial connection is complete"
mongoose.set('bufferCommands', true);

/**
 * Global is used here to maintain a cached connection across hot-reloads 
 * in development and serverless invocations in production.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { 
    conn: null, 
    promise: null,
    isUsingReserve: false 
  };
}

const commonOpts = {
  bufferCommands: true, // Explicitly enable for serverless safety
  maxPoolSize: 2,
  minPoolSize: 1,
  serverSelectionTimeoutMS: 5000, 
  socketTimeoutMS: 30000,
  family: 4, 
  autoIndex: false, 
  connectTimeoutMS: 10000, 
};

export async function connectToDatabase() {
  // 1. Return cached connection if alive
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // 2. If a connection attempt is already in progress, await it
  if (cached.promise) {
    try {
      return await cached.promise;
    } catch (err) {
      console.error("Existing connection promise failed, retrying...");
      cached.promise = null;
    }
  }

  // 3. Define the connection logic
  const attemptConnection = async () => {
    const primaryURI = process.env.AGENT_DB_URI || process.env.MONGODB_URI;
    const reserveURI = process.env.USER_DB_URI;

    if (!primaryURI) {
      throw new Error("MONGODB_URI or AGENT_DB_URI is not defined in environment variables.");
    }

    try {
      console.log("📡 Connecting to Primary Database Instance...");
      const conn = await mongoose.connect(primaryURI, commonOpts);
      cached.isUsingReserve = false;
      return conn;
    } catch (primaryError) {
      console.error(`⚠️ Primary Cluster Unreachable: ${primaryError.message}`);
      
      if (reserveURI) {
        try {
          console.log("📡 Routing connection failover to Reserve DB...");
          const conn = await mongoose.connect(reserveURI, commonOpts);
          cached.isUsingReserve = true;
          return conn;
        } catch (reserveError) {
          console.error("❌ High Availability Failure: Both Database Clusters are offline.");
          throw new Error("All database target engines are currently unreachable.");
        }
      }
      throw primaryError;
    }
  };

  // 4. Cache the promise to prevent race conditions during concurrent requests
  cached.promise = attemptConnection();
  
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; 
    cached.conn = null;
    throw err; 
  }

  return cached.conn;
}