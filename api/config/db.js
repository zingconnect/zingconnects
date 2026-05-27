import mongoose from 'mongoose';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { 
    conn: null, 
    promise: null,
    isUsingReserve: false 
  };
}

const commonOpts = {
  maxPoolSize: 2,   // Reduced from 10 to protect multi-instance cluster exhaustion
  minPoolSize: 1,                  
  serverSelectionTimeoutMS: 5000, 
  socketTimeoutMS: 30000,
  family: 4,
  bufferCommands: false, 
  autoIndex: false, 
  connectTimeoutMS: 10000, 
};
/**
 * Serverless Fail-Safe Connection Handler
 */
export async function connectToDatabase() {
  // 1. Return immediately if an active, healthy connection exists
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // 2. Await an existing connection attempt if one is already processing
  if (cached.promise) {
    console.log("⏳ Connection in progress, awaiting existing promise...");
    try {
      await cached.promise;
      if (mongoose.connection.readyState === 1) {
        return cached.conn;
      }
    } catch (err) {
      cached.promise = null; // Clear out a broken promise context on error
    }
  }

  // 3. Define the sequential execution loop cleanly
  const attemptConnection = async () => {
    const primaryURI = process.env.AGENT_DB_URI || process.env.MONGODB_URI;
    const reserveURI = process.env.USER_DB_URI;

    try {
      console.log("📡 Attempting connection to PRIMARY DB...");
      const primaryConn = await mongoose.connect(primaryURI, commonOpts);
      cached.isUsingReserve = false;
      console.log("✅ Connected to Primary Database Cluster");
      return primaryConn;
    } catch (primaryError) {
      console.error(`⚠️ Primary DB Unreachable: ${primaryError.message}`);
      
      if (reserveURI) {
        try {
          console.log("📡 Attempting fallback to RESERVE DB...");
          const reserveConn = await mongoose.connect(reserveURI, commonOpts);
          cached.isUsingReserve = true;
          console.log("✅ Connected to Reserve Database Cluster");
          return reserveConn;
        } catch (reserveError) {
          console.error("❌ Reserve DB Cluster connection also failed.");
          throw new Error("All designated database clusters are unreachable.");
        }
      } else {
        throw primaryError;
      }
    }
  };

  // Assign connection execution loop to the promise cache
  cached.promise = attemptConnection();
  
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // Reset cache states so the container can retry next invocation
    cached.conn = null;
    throw err; 
  }

  return cached.conn;
}