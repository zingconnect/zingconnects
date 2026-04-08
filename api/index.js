console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken'; // New: JWT Import
import { fileURLToPath } from 'url';
import { agentSchema } from './models/Agent.js'; 

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- MULTI-DATABASE SETUP ---
const userDb = mongoose.createConnection(process.env.USER_DB_URI);
const agentDb = mongoose.createConnection(process.env.AGENT_DB_URI);

const Agent = agentDb.model('Agent', agentSchema);

// --- AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access Denied" });

  jwt.verify(token, process.env.JWT_SECRET, (err, agent) => {
    if (err) return res.status(403).json({ message: "Invalid Token" });
    req.agent = agent;
    next();
  });
};

// --- API ROUTES ---

// 1. Register New Agent
app.post('/api/agents/register', async (req, res) => {
  try {
    const newAgent = new Agent(req.body);
    await newAgent.save();
    
    // Generate token immediately on registration so they are logged in
    const token = jwt.sign({ id: newAgent._id, slug: newAgent.slug }, process.env.JWT_SECRET, { expiresIn: '24h' });
    
    res.status(201).json({ success: true, token, slug: newAgent.slug });
  } catch (err) {
    res.status(400).json({ success: false, message: "Email or Slug already exists" });
  }
});

// 2. Agent Login (For the Portal Modal in AgentSlug.jsx)
app.post('/api/agents/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const agent = await Agent.findOne({ email });
    if (!agent || agent.password !== password) { // In prod, use bcrypt.compare()
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: agent._id, slug: agent.slug }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ success: true, token, slug: agent.slug });
  } catch (err) {
    res.status(500).json({ message: "Login error" });
  }
});

// 3. Fetch Agent Profile (Public)
app.get('/api/agents/:slug', async (req, res) => {
  try {
    const agent = await Agent.findOne({ slug: req.params.slug }).select('-password');
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// 4. Protected Route: Agent Dashboard Data
app.get('/api/portal/dashboard', authenticateToken, async (req, res) => {
  // Only accessible if the browser sends a valid JWT
  const agent = await Agent.findById(req.agent.id).select('-password');
  res.json({ message: "Welcome to your secure portal", agent });
});

// --- SYSTEM & PRODUCTION ---
app.get('/health', (req, res) => res.status(200).send('OK'));

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.resolve(distPath, 'index.html')));
}

export default app;