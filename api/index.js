console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken'; 
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

// 1. Agent Registration with Image Upload & Unique Slug Logic
app.post('/api/agents/register', upload.single('photo'), async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("CRITICAL ERROR: JWT_SECRET is missing");
      return res.status(500).json({ success: false, message: "Server configuration error" });
    }

    const { firstName, lastName, email } = req.body;

    // --- 1. GENERATE UNIQUE SLUG ---
    const cleanFirst = firstName.trim().replace(/[^a-zA-Z0-9]/g, '');
    const cleanLast = lastName.trim().replace(/[^a-zA-Z0-9]/g, '');
    const baseSlug = `${cleanFirst}${cleanLast}`.toLowerCase();
    
    let finalSlug = baseSlug;
    let counter = 1;

    let slugExists = await Agent.findOne({ slug: finalSlug });
    while (slugExists) {
      counter++;
      const suffix = counter < 10 ? `-0${counter}` : `-${counter}`;
      finalSlug = `${baseSlug}${suffix}`;
      slugExists = await Agent.findOne({ slug: finalSlug });
    }

    // --- 2. HANDLE IMAGE UPLOAD & SIGNED URL ---
    let photoUrl = "";
    if (req.file) {
      const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
      const fileKey = `profiles/${fileName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        // No ACL added here as per your Private Key requirement
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      
      // Create a Signed URL for private access (valid for 7 days)
      const getCommand = new GetObjectCommand({
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: fileKey,
      });

      photoUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 604800 });
    }

    // --- 3. CREATE AGENT DOCUMENT ---
    const newAgent = new Agent({
      ...req.body,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      slug: finalSlug,
      photoUrl: photoUrl || "",
      role: 'agent',    
      program: req.body.program || "N/A",
      bio: req.body.bio || "",
      plan: req.body.plan || "BASIC"
    });

    await newAgent.save();
    
    const token = jwt.sign(
      { id: newAgent._id, slug: newAgent.slug }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.status(201).json({ 
      success: true, 
      token, 
      slug: finalSlug,
      message: "Registration successful" 
    });

  } catch (err) {
    console.error("Registration Error Detail:", err);
    let errorMessage = err.message;
    if (err.code === 11000) {
      const duplicateField = Object.keys(err.keyValue)[0];
      errorMessage = `${duplicateField.charAt(0).toUpperCase() + duplicateField.slice(1)} already exists.`;
    }
    res.status(400).json({ success: false, message: errorMessage });
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

app.get('/api/agents/:slug', async (req, res) => {
  try {
    const agent = await Agent.findOne({ slug: req.params.slug }).select('-password');
    
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    const agentObj = agent.toObject();

    if (agentObj.photoUrl) {
      try {
        // This regex extracts JUST the filename from a full URL or a path
        // It looks for everything after the last '/' and before any '?'
        const parts = agentObj.photoUrl.split('/');
        const fileName = parts[parts.length - 1].split('?')[0];
        
        // RE-CONSTRUCT THE KEY MANUALLY
        const fileKey = `profiles/${fileName}`;

        const getCommand = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
        });

        // Generate the fresh signature
        agentObj.photoUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      } catch (s3Err) {
        console.error("Signing failed, using original or empty:", s3Err.message);
        // If signing fails, don't crash; just keep going
      }
    }

    res.json(agentObj);
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ message: "Internal Server Error" });
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

  // Corrected wildcard for Vercel/Express Compatibility
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return; 
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
 
export default app;