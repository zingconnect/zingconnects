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
  maxPoolSize: 10,                 
  minPoolSize: 1,                  
  serverSelectionTimeoutMS: 5000, 
  socketTimeoutMS: 30000,
  family: 4,
  bufferCommands: false, // Prevents queries from hanging indefinitely when connection is offline
  autoIndex: false, 
  connectTimeoutMS: 10000, 
};

/**
 * Serverless-Optimized Connection Handler
 */
export async function connectToDatabase() {
  // 1. If already connected, immediately return the active instance
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // 2. If a connection is in progress, wait for it to complete
  if (cached.promise) {
    console.log("⏳ Connection in progress, awaiting existing promise...");
    try {
      await cached.promise;
      if (mongoose.connection.readyState === 1) {
        return cached.conn;
      }
    } catch (err) {
      // Clear the broken promise context so subsequent requests can retry cleanly
      cached.promise = null;
    }
  }

  // 3. Define the connection sequence
  const attemptConnection = async () => {
    // Fallback assignment to guard against missing env strings
    const primaryURI = process.env.AGENT_DB_URI || process.env.MONGODB_URI; 
    const reserveURI = process.env.USER_DB_URI;

    try {
      console.log("📡 Attempting connection to PRIMARY DB...");
      const primaryConn = await mongoose.connect(primaryURI, commonOpts);
      cached.isUsingReserve = false;
      console.log("✅ Primary DB Connection Established");
      return primaryConn;
    } catch (primaryError) {
      console.error(`⚠️ Primary DB Error: ${primaryError.message}. checking failover options...`);
      
      if (reserveURI) {
        try {
          console.log("📡 Switching to RESERVE DB cluster...");
          const reserveConn = await mongoose.connect(reserveURI, commonOpts);
          cached.isUsingReserve = true;
          console.log("✅ Reserve DB Connection Established");
          return reserveConn;
        } catch (reserveError) {
          console.error("❌ Reserve DB Cluster connection also failed.");
          throw new Error("All database clusters are currently unreachable.");
        }
      } else {
        throw primaryError;
      }
    }
  };

  // Assign the execution promise to the cache tracker
  cached.promise = attemptConnection();
  
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null; // Clear out the broken promise on failure
    cached.conn = null;
    throw err; 
  }

  return cached.conn;
}