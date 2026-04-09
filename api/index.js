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
import User from './models/User.js'; // Ensure the path is correct
import authRoutes from './routes/auth.js'; 

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

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }

  // FIXED: Removed useNewUrlParser and useUnifiedTopology
  const opts = {
    serverSelectionTimeoutMS: 10000, 
    socketTimeoutMS: 45000, 
    family: 4 
  };

  try {
    // Log host only for safety
    console.log("Connecting to:", process.env.AGENT_DB_URI.split('@')[1]); 
    cachedDb = await mongoose.connect(process.env.AGENT_DB_URI, opts);
    console.log("MongoDB Connected Successfully");
    return cachedDb;
  } catch (err) {
    console.error("CRITICAL MONGODB ERROR:", err.message);
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

app.post('/api/agents/register', upload.single('photo'), async (req, res) => {
  console.log("Registration attempt started...");

  try {
    await connectToDatabase();

    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !email || !password) {
      return res.status(400).json({ success: false, message: "Required fields missing" });
    }

    // --- 1. SLUG GENERATION ---
    const cleanFirst = firstName.trim().replace(/[^a-zA-Z0-9]/g, '');
    const cleanLast = (lastName || "").trim().replace(/[^a-zA-Z0-9]/g, '');
    const baseSlug = `${cleanFirst}${cleanLast}`.toLowerCase() || "agent";
    
    let finalSlug = baseSlug;
    let counter = 1;
    let slugExists = await Agent.findOne({ slug: finalSlug });

    while (slugExists) {
      counter++;
      finalSlug = `${baseSlug}-${counter}`;
      slugExists = await Agent.findOne({ slug: finalSlug });
    }

    // --- 2. PHOTO UPLOAD (REFINED FOR IDRIVE) ---
    let savedPhotoPath = "";
    if (req.file) {
      console.log(`Uploading file: ${req.file.originalname}`);
      try {
        const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
        const fileKey = `profiles/${fileName}`;
        const bucketName = process.env.IDRIVE_BUCKET_NAME || "livechat";
        
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }));
        
        // IDrive E2 format: https://[bucket].[endpoint]/[key]
        const rawEndpoint = (process.env.IDRIVE_ENDPOINT || "").replace('https://', '');
        savedPhotoPath = `https://${bucketName}.${rawEndpoint}/${fileKey}`;
        console.log("Upload Success:", savedPhotoPath);

      } catch (uploadErr) {
        // If this logs "Access Denied", your IDrive Keys are wrong.
        // If this logs "NoSuchBucket", your bucket name is wrong.
        console.error("IDRIVE UPLOAD FAILED:", uploadErr.name, "-", uploadErr.message);
      }
    }

    // --- 3. PASSWORD HASHING ---
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // --- 4. CREATE DOCUMENT ---
    const newAgent = new Agent({
      firstName: firstName.trim(),
      lastName: (lastName || "").trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      dob: req.body.dob,
      gender: req.body.gender,
      occupation: req.body.occupation,
      address: req.body.address,
      bio: req.body.bio || "",
      program: req.body.program || "N/A",  
      slug: finalSlug,
      photoUrl: savedPhotoPath, // This will now be filled if upload succeeded
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
    
    res.status(201).json({ 
      success: true, 
      token, 
      slug: finalSlug, 
      message: "Registration successful." 
    });

  } catch (err) {
    console.error("Registration Error:", err);
    res.status(err.code === 11000 ? 400 : 500).json({ 
      success: false, 
      message: err.code === 11000 ? "Email already exists" : "Internal Server Error" 
    });
  }
});

// 1. Agent Login (Enhanced with selection for security)
app.post('/api/agents/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;

    // Explicitly select password since it might be hidden in the schema
    const agent = await Agent.findOne({ email: email.toLowerCase().trim() }).select('+password');
    
    if (!agent) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Include role in token to prevent users from accessing agent routes
    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
      message: "Agent Verified" 
    });
  } catch (err) {
    console.error("Agent Login Error:", err);
    res.status(500).json({ success: false, message: "Server login error" });
  }
});

app.get('/api/agents/my-users', async (req, res) => {
  try {
    await connectToDatabase();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Unauthorized access" });
    }

    const token = authHeader.split(' ')[1];
    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.role !== 'agent') {
        return res.status(403).json({ message: "Forbidden: Agent access only" });
      }
    } catch (err) {
      return res.status(401).json({ message: "Session expired" });
    }
    const myUsers = await User.find({ 
      connectedAgents: decoded.id 
    })
    .select('email lastLogin createdAt') // Only fetch what we need for the sidebar
    .sort({ lastLogin: -1 }); // Show most recently active users at the top
    res.json(myUsers);

  } catch (err) {
    console.error("Fetch My Users Error:", err);
    res.status(500).json({ message: "Error retrieving connected users" });
  }
});

// 2. User Handshake (Email-only access)
app.post('/api/users/handshake', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, agentId, agentSlug } = req.body;

    if (!email) return res.status(400).json({ message: "Email required" });

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    let user = await User.findOne({ email: normalizedEmail });
    let isNewUser = false;

    if (!user) {
      // Create new user if first time
      user = new User({
        email: normalizedEmail,
        connectedAgents: [agentId], // Track which agent they are talking to
        lastLogin: new Date()
      });
      await user.save();
      isNewUser = true;

      // --- TODO: TRIGGER EMAIL NOTIFICATION HERE ---
      // console.log(`Notification: New user ${normalizedEmail} joined via agent ${agentSlug}`);
    } else {
      // If user exists, ensure agentId is in their connected list
      if (!user.connectedAgents.includes(agentId)) {
        user.connectedAgents.push(agentId);
      }
      user.lastLogin = new Date();
      await user.save();
    }

    // Generate User-specific token
    const token = jwt.sign(
      { id: user._id, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Users get longer sessions for convenience
    );

    res.json({ 
      success: true, 
      token, 
      isNewUser,
      message: isNewUser ? "Welcome! Profile created." : "Welcome back."
    });

  } catch (err) {
    console.error("Handshake Error:", err);
    res.status(500).json({ success: false, message: "Handshake failed" });
  }
});

app.get('/api/users/my-session', async (req, res) => {
  try {
    await connectToDatabase();

    // 1. Extract and Verify Token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "No authorization token provided" });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Session expired or invalid" });
    }
    const user = await User.findById(decoded.id).populate({
      path: 'connectedAgents',
      select: 'firstName lastName photoUrl occupation program bio slug' // Only select public info
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const activeAgent = user.connectedAgents[user.connectedAgents.length - 1];

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
      },
      agent: activeAgent || null,
      message: "Session established successfully"
    });

  } catch (err) {
    console.error("Session API Error:", err);
    res.status(500).json({ message: "Internal server error during session fetch" });
  }
});

app.get('/api/agents/:slug', async (req, res) => {
  try {
    console.log("Fetching profile for slug:", req.params.slug);
    await connectToDatabase();
    
    const agent = await Agent.findOne({ slug: req.params.slug }).select('-password');
    
    if (!agent) {
      console.log("Result: Agent not found in DB");
      return res.status(404).json({ message: "Agent not found" });
    }

    const agentObj = agent.toObject();

    // Check if photoUrl exists AND is a valid string before processing
    if (agentObj.photoUrl && typeof agentObj.photoUrl === 'string' && agentObj.photoUrl.includes('/')) {
      try {
        const urlParts = agentObj.photoUrl.split('/');
        const fileName = urlParts[urlParts.length - 1].split('?')[0]; 
        const fileKey = `profiles/${fileName}`;

        console.log("Generating Signed URL for Key:", fileKey);

        const getCommand = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
        });

        // If this fails, the catch(s3Err) handles it without crashing the route
        agentObj.photoUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      } catch (s3Err) {
        console.error("S3/IDrive Signing Error (Non-Fatal):", s3Err.message);
        // We keep the original photoUrl so the profile still loads
      }
    }

    res.json(agentObj);
  } catch (err) {
    console.error("CRITICAL ROUTE ERROR:", err.stack); // This will show exactly which line failed
    res.status(500).json({ 
      message: "Error processing profile", 
      error: err.message // Temporary: helps you see the error in the browser network tab
    });
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