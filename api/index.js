console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken'; 
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fileURLToPath } from 'url';
import { agentSchema } from './models/Agent.js'; 

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- IDRIVE E2 / S3 CONFIGURATION ---
const s3Client = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
  },
});

const upload = multer({ storage: multer.memoryStorage() });

// --- DATABASE SINGLETON (Vercel Optimized) ---
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  // FIXED: Defined connection options to prevent ReferenceError
  const opts = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
  };

  try {
    cachedDb = await mongoose.connect(process.env.AGENT_DB_URI, opts);
    console.log("MongoDB Connected Successfully");
    return cachedDb;
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
    throw err;
  }
}

// Initialize Model on the default connection
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

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

// --- ROUTES ---

// 1. Agent Registration
app.post('/api/agents/register', upload.single('photo'), async (req, res) => {
  try {
    await connectToDatabase();

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ success: false, message: "Server config error" });
    }

    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !email || !password) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // SLUG GENERATION
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

    // PHOTO UPLOAD
    let savedPhotoPath = "";
    if (req.file) {
      try {
        const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
        const fileKey = `profiles/${fileName}`;
        
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }));
        
        const endpoint = (process.env.IDRIVE_ENDPOINT || "s3.amazonaws.com").replace('https://', '');
        savedPhotoPath = `https://${endpoint}/${process.env.IDRIVE_BUCKET_NAME}/${fileKey}`;
      } catch (uploadErr) {
        console.error("S3 Upload Failed:", uploadErr.message);
      }
    }

    // PASSWORD HASHING
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newAgent = new Agent({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      dob: req.body.dob,
      gender: req.body.gender,
      occupation: req.body.occupation,
      address: req.body.address,
      bio: req.body.bio || "",
      program: req.body.program || "N/A",  
      slug: finalSlug,
      photoUrl: savedPhotoPath,
      role: 'agent',    
      status: 'active',           
      isSubscribed: false,        
      plan: req.body.plan || "BASIC" 
    });

    await newAgent.save();    
    
    const token = jwt.sign(
      { id: newAgent._id, slug: newAgent.slug }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    res.status(201).json({ success: true, token, slug: finalSlug, message: "Registration successful." });

  } catch (err) {
    console.error("Registration Error:", err);
    res.status(err.code === 11000 ? 400 : 500).json({ 
      success: false, 
      message: err.code === 11000 ? "Email already exists" : "Internal Server Error" 
    });
  }
});

// 2. Agent Login (FIXED: Now uses bcrypt.compare)
app.post('/api/agents/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;
    
    const agent = await Agent.findOne({ email: email.toLowerCase().trim() });
    if (!agent) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
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

// 3. Get Public Profile
app.get('/api/agents/:slug', async (req, res) => {
  try {
    await connectToDatabase();
    const agent = await Agent.findOne({ slug: req.params.slug }).select('-password');
    
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const agentObj = agent.toObject();

    if (agentObj.photoUrl) {
      try {
        const urlParts = agentObj.photoUrl.split('/');
        const fileName = urlParts[urlParts.length - 1].split('?')[0]; 
        const fileKey = `profiles/${fileName}`;

        const getCommand = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
        });
        agentObj.photoUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      } catch (s3Err) {
        console.error("S3 Get Error:", s3Err.message);
      }
    }

    res.json(agentObj);
  } catch (err) {
    res.status(500).json({ message: "Error processing profile" });
  }
});

// 4. Protected Dashboard
app.get('/api/portal/dashboard', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const agent = await Agent.findById(req.agent.id).select('-password');
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ message: "Error fetching dashboard" });
  }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

export default app;