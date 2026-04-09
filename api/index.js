console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken'; 
import bcrypt from 'bcryptjs';
import multer from 'multer';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
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

const flw = new Flutterwave(process.env.VITE_FLW_PUBLIC_KEY, process.env.VITE_FLW_SECRET_KEY);

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

app.post('/api/agents/login', async (req, res) => {
  try {
    await connectToDatabase();
    
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }
    const agent = await Agent.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!agent) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Final Payload
    res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
      isSubscribed: !!agent.isSubscribed, 
      plan: agent.plan || "BASIC",        
      message: "Agent Verified" 
    });

  } catch (err) {
    console.error("Agent Login Error:", err);
    res.status(500).json({ success: false, message: "Server login error" });
  }
});

app.get('/api/agents/profile', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    let agent = await Agent.findById(req.agent.id).select('-password'); 
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    if (agent.isSubscribed && agent.expiryDate && new Date() > new Date(agent.expiryDate)) {
      console.log(`Locking account for ${agent.email} - Subscription Expired.`);
      agent.isSubscribed = false;
      await agent.save(); // Persist the lockout
    }

    res.json(agent); 
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching profile" });
  }
});

app.get('/api/agents/profile/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // 1. Find the agent (the 'authenticateToken' middleware should provide req.agent.id)
    let agent = await Agent.findById(req.agent.id).select('-password'); 
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // 2. Expiry Logic (The Lazy Check)
    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      console.log(`[SUBSCRIPTION] Locking account: ${agent.email}`);
      agent.isSubscribed = false;
      // We don't necessarily clear the expiryDate so the user can see when it ended
      await agent.save(); 
    }

    // 3. Return the data
    // Ensure these fields exist in your Schema, or they will return undefined
    res.json({
      success: true,
      firstName: agent.firstName,
      lastName: agent.lastName,
      occupation: agent.occupation,
      program: agent.program,
      bio: agent.bio,
      address: agent.address,
      photoUrl: agent.photoUrl,
      slug: agent.slug,
      plan: agent.plan,
      isSubscribed: agent.isSubscribed,
      subscriptionAmount: agent.subscriptionAmount || 0,
      subscriptionDate: agent.subscriptionDate,
      expiryDate: agent.expiryDate
    }); 

  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ success: false, message: "Server error fetching profile" });
  }
});

// 3. Update Agent Plan Selection
app.post('/api/agents/update-plan', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { plan } = req.body; // e.g., "PRO"

    const updatedAgent = await Agent.findByIdAndUpdate(
      req.user.id,
      { plan: plan },
      { new: true }
    );

    res.json({ success: true, plan: updatedAgent.plan });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update plan" });
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
    console.log("--- Profile Request Start ---");
    console.log("Slug requested:", req.params.slug);
    
    await connectToDatabase();

    // 1. Check if the Agent model is available
    if (!Agent) {
      throw new Error("Agent model is not initialized");
    }

    const agent = await Agent.findOne({ slug: req.params.slug }).select('-password');
    
    if (!agent) {
      console.log("Profile not found in MongoDB for slug:", req.params.slug);
      return res.status(404).json({ message: "Agent not found" });
    }

    // Convert to plain object so we can modify photoUrl
    const agentObj = agent.toObject();

    // 2. STRENGTHENED PHOTO LOGIC
    // Only attempt S3 signing if photoUrl exists and looks like an IDrive path
    if (agentObj.photoUrl && typeof agentObj.photoUrl === 'string' && agentObj.photoUrl.includes('profiles/')) {
      try {
        // Extract just the filename. 
        // Example: https://.../profiles/17123456-pic.jpg -> profiles/17123456-pic.jpg
        const urlParts = agentObj.photoUrl.split('profiles/');
        const fileName = urlParts[urlParts.length - 1].split('?')[0]; 
        const fileKey = `profiles/${fileName}`;

        console.log("Generating signed URL for:", fileKey);

        const getCommand = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
        });

        // Use a 1-hour expiry
        agentObj.photoUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
      } catch (s3Err) {
        console.error("S3 Signing Error (Handled):", s3Err.message);
        // Do not crash the app; the frontend will use the fallback avatar
      }
    }

    console.log("--- Profile Request Success ---");
    res.json(agentObj);

  } catch (err) {
    // THIS IS THE CRITICAL LOG: Check your Vercel logs for this exact line
    console.error("CRITICAL 500 ERROR IN /api/agents/:slug :", err);
    res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      details: err.message 
    });
  }
});

// --- Update Agent Profile (Protected) ---
app.put('/api/agents/update-profile', async (req, res) => {
  try {
    await connectToDatabase();

    // 1. Extract Token from Headers
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(' ')[1];
    
    // 2. Verify Token (using your secret)
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ message: "Session expired. Please log in again." });
    }

    // 3. Find and Update the Agent
    // We only allow specific fields to be updated for security
    const { firstName, lastName, occupation, program, bio, address } = req.body;

    const updatedAgent = await Agent.findByIdAndUpdate(
      decoded.id, 
      { 
        $set: { 
          firstName, 
          lastName, 
          occupation, 
          program, 
          bio, 
          address 
        } 
      },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedAgent) {
      return res.status(404).json({ message: "Agent account not found" });
    }

    console.log(`Profile updated successfully for: ${updatedAgent.email}`);
    
    res.json({
      success: true,
      message: "Identity synchronized across all secure nodes.",
      agent: updatedAgent
    });

  } catch (err) {
    console.error("Update Error:", err);
    res.status(500).json({ 
      message: "Internal server error during profile sync",
      error: err.message 
    });
  }
});

// --- Utility Function to calculate Fixed Naira Amount ---
const getNairaAmount = (usdAmount) => {
  // Pull the rate from .env, or use 1550 as a hard fallback if .env fails to load
  const FIXED_RATE = Number(process.env.USD_TO_NGN_RATE);
  
  // Multiply and round up to the nearest whole Naira for Flutterwave
  return Math.ceil(usdAmount * FIXED_RATE);
};

// --- Route to get the "Price Tag" in Naira for the frontend ---
app.get('/api/subscriptions/rate/:planPrice', async (req, res) => {
  const { planPrice } = req.params;
  const FIXED_RATE = Number(process.env.USD_TO_NGN_RATE);
  
  const nairaEquivalent = getNairaAmount(Number(planPrice));
  
  res.json({
    usd: planPrice,
    ngn: nairaEquivalent,
    rate: FIXED_RATE // Returning the static rate used
  });
});

// --- Payment Verification Route ---
app.post('/api/subscriptions/verify', async (req, res) => {
  try {
    await connectToDatabase();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ message: "Session expired" });
    }

    const { transaction_id, plan, usdAmount } = req.body;

    if (!transaction_id) {
      return res.status(400).json({ message: "Transaction ID is required" });
    }

    // --- USE FIXED RATE FROM ENV ---
    const currentRate = Number(process.env.USD_TO_NGN_RATE) || 1550;

    const response = await flw.Transaction.verify({ id: transaction_id });
    const data = response.data;
    
    // Calculate expected amount based on your fixed rate
    const expectedNaira = usdAmount * currentRate;
    const margin = 0.98; // Allows for 2% variance just in case

    if (
      data.status === "successful" &&
      data.currency === "NGN" &&
      data.amount >= (expectedNaira * margin)
    ) {
      
      const now = new Date();
      let expiry = new Date();

      if (plan === 'BASIC') {
        expiry.setMonth(now.getMonth() + 1);
      } else if (plan === 'GROWTH') {
        expiry.setMonth(now.getMonth() + 6);
      } else if (plan === 'PROFESSIONAL') {
        expiry.setFullYear(now.getFullYear() + 1);
      }

      const updatedAgent = await Agent.findByIdAndUpdate(
        decoded.id,
        {
          $set: {
            isSubscribed: true,
            plan: plan,
            subscriptionDate: now,
            subscriptionAmount: usdAmount,
            expiryDate: expiry, 
            expiryNotificationSent: false,
            lastTransactionId: transaction_id,
            paymentDetails: {
              amountNgn: data.amount,
              rateUsed: currentRate, // Log the fixed rate used at time of purchase
              currency: "NGN"
            }
          }
        },
        { new: true }
      ).select('-password');

      console.log(`Subscription ACTIVATED at FIXED RATE (${currentRate}) for: ${updatedAgent.email}`);

      return res.json({
        success: true,
        message: "Payment verified at platform rate. Secure node activated.",
        agent: updatedAgent
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Amount does not match platform rate."
      });
    }

  } catch (err) {
    console.error("FLW VERIFICATION ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
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