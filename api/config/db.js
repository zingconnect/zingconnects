import mongoose from 'mongoose';

// Ensure Mongoose handles operational queueing correctly
mongoose.set('bufferCommands', true);

/**
 * Global cache to maintain connection across hot-reloads and serverless invocations.
 */
let cached = global.mongoose || { conn: null, promise: null, isUsingReserve: false };
if (!global.mongoose) global.mongoose = cached;

const commonOpts = {
  bufferCommands: true,
  maxPoolSize: 10, // Increased for better concurrency
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  family: 4,
  autoIndex: false,
};

export async function connectToDatabase() {
  if (cached.conn && (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2)) {
    return cached.conn;
  }

  // 2. If a connection process is already active, await that same promise
  if (cached.promise) {
    return cached.promise;
  }

  // 3. Initiate new connection attempt
  cached.promise = (async () => {
    const primaryURI = process.env.AGENT_DB_URI || process.env.MONGODB_URI;
    const reserveURI = process.env.USER_DB_URI;

    if (!primaryURI) {
      throw new Error("Database URI is not defined in environment variables.");
    }

    try {
      console.log("📡 Attempting connection to Primary Cluster...");
      const conn = await mongoose.connect(primaryURI, commonOpts);
      cached.isUsingReserve = false;
      cached.conn = conn;
      return conn;
    } catch (primaryError) {
      console.error(`⚠️ Primary Cluster Unreachable: ${primaryError.message}`);

      if (reserveURI) {
        console.log("📡 Routing connection failover to Reserve DB...");
        try {
          const conn = await mongoose.connect(reserveURI, commonOpts);
          cached.isUsingReserve = true;
          cached.conn = conn;
          return conn;
        } catch (reserveError) {
          throw new Error("High Availability Failure: All database clusters are offline.");
        }
      }
      throw primaryError;
    }
  })();

  // 4. Ensure cleanup if the promise ultimately fails
  try {
    return await cached.promise;
  } catch (err) {
    cached.promise = null;
    mongoose.disconnect(); 
    throw err;
  }
}