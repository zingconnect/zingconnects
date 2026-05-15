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
  socketTimeoutMS: 45000,
  family: 4,
  bufferCommands: false, 
  autoIndex: false, 
  connectTimeoutMS: 10000, 
};

/**
 * Main Connection Handler with Reserve Failover
 */
export async function connectToDatabase() {
  // 1. If we have a connection, check if it's actually ready
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // 2. If a connection is in progress (readyState 2), WE MUST WAIT FOR IT
  // This is where 'bufferCommands: false' usually causes crashes.
  if (cached.promise) {
    console.log("⏳ Connection in progress, awaiting existing promise...");
    await cached.promise;
    
    // Double check it's actually ready after awaiting
    if (mongoose.connection.readyState === 1) {
       return cached.conn;
    }
  }

  // 3. Define the connection attempt (Your existing logic)
  const attemptConnection = async () => {
    try {
      console.log("📡 Attempting connection to PRIMARY AGENT DB...");
      const primaryConn = await mongoose.connect(process.env.AGENT_DB_URI, commonOpts);
      cached.isUsingReserve = false;
      return primaryConn;
    } catch (primaryError) {
      console.error("⚠️ Primary DB is FULL or Lagging. Switching to RESERVE...");
      try {
        const reserveConn = await mongoose.connect(process.env.USER_DB_URI, commonOpts);
        cached.isUsingReserve = true;
        return reserveConn;
      } catch (reserveError) {
        throw new Error("No database available.");
      }
    }
  };

  cached.promise = attemptConnection();
  
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err; // Throw instead of returning null to stop the route execution
  }

  return cached.conn;
}
