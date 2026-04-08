import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- MULTI-DATABASE SETUP ---

// Connection for standard Users
const userDb = mongoose.createConnection(process.env.USER_DB_URI);
userDb.on('connected', () => console.log("✅ User Database Connected"));

// Connection for Agents/Consultants/Owners
const agentDb = mongoose.createConnection(process.env.AGENT_DB_URI);
agentDb.on('connected', () => console.log("✅ Agent Database Connected"));

// Handle errors
userDb.on('error', (err) => console.log("❌ User DB Error:", err));
agentDb.on('error', (err) => console.log("❌ Agent DB Error:", err));

// Export connections for use in Models
export { userDb, agentDb };

// --- ROUTES ---

app.get('/api/test', (req, res) => {
  res.send("ZingConnect API is running with Dual DBs...");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server launched on port ${PORT}`);
});