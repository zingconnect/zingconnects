import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MULTI-DATABASE SETUP ---
const userDb = mongoose.createConnection(process.env.USER_DB_URI);
userDb.on('connected', () => console.log("✅ User Database Connected"));

const agentDb = mongoose.createConnection(process.env.AGENT_DB_URI);
agentDb.on('connected', () => console.log("✅ Agent Database Connected"));

userDb.on('error', (err) => console.log("❌ User DB Error:", err));
agentDb.on('error', (err) => console.log("❌ Agent DB Error:", err));

export { userDb, agentDb };

app.get('/api/test', (req, res) => {
  res.send("ZingConnect API is running with Dual DBs...");
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server launched on port ${PORT}`);
});