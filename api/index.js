console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken'; 
import multer from 'multer';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fileURLToPath } from 'url';
import { agentSchema } from './models/Agent.js'; 

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- IDRIVE E2 / S3 CONFIGURATION ---
const s3Client = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
  },
});

// Multer in-memory storage for Vercel compatibility
const upload = multer({ storage: multer.memoryStorage() });

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

// 1. Agent Registration with Image Upload
app.post('/api/agents/register', upload.single('photo'), async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("CRITICAL ERROR: JWT_SECRET is missing");
      return res.status(500).json({ success: false, message: "Server configuration error" });
    }

    let photoUrl = "";

    // If a file was uploaded, push to IDrive E2
    if (req.file) {
      const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: `profiles/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        // ACL: 'public-read' // Note: Ensure your bucket policy allows public reading
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      
      // Construct the public URL
      photoUrl = `${process.env.IDRIVE_ENDPOINT}/${process.env.IDRIVE_BUCKET_NAME}/profiles/${fileName}`;
    }

    // Create the agent document
    const newAgent = new Agent({
      ...req.body,
      photoUrl: photoUrl || "",
    });

    await newAgent.save();
    
    // Generate JWT Token
    const token = jwt.sign(
      { id: newAgent._id, slug: newAgent.slug }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.status(201).json({ 
      success: true, 
      token, 
      slug: newAgent.slug,
      message: "Registration successful" 
    });

  } catch (err) {
    console.error("Registration Error Detail:", err);
    res.status(400).json({ 
      success: false, 
      message: err.code === 11000 ? "Email or Slug already exists" : err.message 
    });
  }
});

// 2. Agent Login
app.post('/api/agents/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const agent = await Agent.findOne({ email });
    if (!agent || agent.password !== password) {
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
  try {
    const agent = await Agent.findById(req.agent.id).select('-password');
    res.json({ message: "Welcome to your secure portal", agent });
  } catch (err) {
    res.status(500).json({ message: "Error fetching dashboard" });
  }
});

// --- SYSTEM & PRODUCTION ---
app.get('/health', (req, res) => res.status(200).send('OK'));

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));

  app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
 
export default app;