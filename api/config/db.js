import mongoose from 'mongoose';

// Disabling command buffering ensures serverless functions fail fast instead of hanging on timeouts
mongoose.set('bufferCommands', false);

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { 
    conn: null, 
    promise: null,
    isUsingReserve: false 
  };
}

const commonOpts = {
  maxPoolSize: 2, // Keeps concurrent connection limits low for serverless edge scaling
  minPoolSize: 1,                  
  serverSelectionTimeoutMS: 5000, 
  socketTimeoutMS: 30000,
  family: 4, // Forces IPv4 resolution over IPv6 to avoid connection latency hits
  autoIndex: false, // Prevents resource heavy index builds on every API call invocation
  connectTimeoutMS: 10000, 
};

export async function connectToDatabase() {
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (cached.promise) {
    try {
      await cached.promise;
      if (mongoose.connection.readyState === 1) {
        return cached.conn;
      }
    } catch (err) {
      cached.promise = null; // Flush broken initialization handlers
    }
  }

  const attemptConnection = async () => {
    // 🛡️ Ensure your core models are imported/compiled BEFORE connecting 
    // to prevent your models from disappearing mid-invocation!
    
    const primaryURI = process.env.AGENT_DB_URI || process.env.MONGODB_URI;
    const reserveURI = process.env.USER_DB_URI;

    try {
      console.log("📡 Connecting to Primary Database Instance Cluster...");
      const primaryConn = await mongoose.connect(primaryURI, commonOpts);
      cached.isUsingReserve = false;
      return primaryConn;
    } catch (primaryError) {
      console.error(`⚠️ Primary Cluster Unreachable: ${primaryError.message}`);
      
      if (reserveURI) {
        try {
          console.log("📡 Routing connection failover to Reserve DB Cluster...");
          const reserveConn = await mongoose.connect(reserveURI, commonOpts);
          cached.isUsingReserve = true;
          return reserveConn;
        } catch (reserveError) {
          console.error("❌ High Availability Failure: Both Database Clusters are offline.");
          throw new Error("All database target engines are currently unreachable.");
        }
      } else {
        throw primaryError;
      }
    }
  };

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