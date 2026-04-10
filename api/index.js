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
import User from './models/User.js'; 
import authRoutes from './routes/auth.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/agents', authRoutes);

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

export async function connectToDatabase() {
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

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access Denied" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid Token" });
    
    req.user = decoded; 

    // Update activity timestamp if the user is an agent
    // We don't 'await' this so we don't slow down the response
    if (decoded.role === 'agent') {
      Agent.findByIdAndUpdate(decoded.id, { lastActive: new Date() }).exec();
    }

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

    // Find agent and explicitly include password for comparison
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

    // JWT Generation - This matches your new middleware 'req.user' logic
    const token = jwt.sign(
      { 
        id: agent._id, 
        slug: agent.slug, 
        role: 'agent' 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // Final Payload
    res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
      // Boolean forced to ensure frontend handles it correctly
      isSubscribed: Boolean(agent.isSubscribed), 
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
    
    // FIX: Changed req.user.id to req.user.id
    let agent = await Agent.findById(req.user.id).select('-password'); 
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // Logic for expiry check
    if (agent.isSubscribed && agent.expiryDate && new Date() > new Date(agent.expiryDate)) {
      console.log(`Locking account for ${agent.email} - Subscription Expired.`);
      agent.isSubscribed = false;
      await agent.save();
    }

    res.json(agent); 
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ success: false, message: "Error fetching profile" });
  }
});

app.get('/api/agents/profile/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // FIX: Use req.user.id to match your middleware logic
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Invalid session credentials" });
    }

    // Agent is already defined at the top of your server file
    let agent = await Agent.findById(req.user.id).select('-password'); 
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // Expiry Logic
    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      await agent.save(); 
    }

    // SIGNING LOGIC
    let signedPhotoUrl = agent.photoUrl;

    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        const fileKey = agent.photoUrl.split('.com/')[1];

        if (fileKey && s3Client) {
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: fileKey,
          });

          signedPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (s3Err) {
        console.error("IDrive Signing Error:", s3Err.message);
      }
    }

    res.json({
      success: true,
      firstName: agent.firstName || "",
      lastName: agent.lastName || "",
      occupation: agent.occupation || "",
      program: agent.program || "",
      bio: agent.bio || "",
     gender: agent.gender || "", 
     dob: agent.dob || "",
      address: agent.address || "",
      photoUrl: signedPhotoUrl, 
      slug: agent.slug || "",
      plan: agent.plan || "BASIC",
      isSubscribed: !!agent.isSubscribed,
      subscriptionAmount: agent.subscriptionAmount || 0,
      subscriptionDate: agent.subscriptionDate,
      expiryDate: agent.expiryDate
    }); 

  } catch (err) {
    console.error("FULL DEBUG ERROR:", err.stack);
    res.status(500).json({ success: false, message: "Internal server error" });
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

// 1. User Handshake (Email-only access) - [STAYS THE SAME]
app.post('/api/users/handshake', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, agentId, agentSlug } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });
    let isNewUser = false;

    if (!user) {
      user = new User({
        email: normalizedEmail,
        connectedAgents: [agentId],
        lastLogin: new Date(),
        isProfileComplete: false // Ensure this starts as false
      });
      await user.save();
      isNewUser = true;
    } else {
      if (!user.connectedAgents.includes(agentId)) {
        user.connectedAgents.push(agentId);
      }
      user.lastLogin = new Date();
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ success: true, token, isNewUser, isProfileComplete: user.isProfileComplete });
  } catch (err) {
    res.status(500).json({ success: false, message: "Handshake failed" });
  }
});

// 2. Updated My-Session with Private Image Signing
app.get('/api/users/my-session', async (req, res) => {
  try {
    await connectToDatabase();
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token" });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).populate({
      path: 'connectedAgents',
      select: 'firstName lastName photoUrl occupation program bio slug'
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    // Get the last connected agent
    let activeAgent = user.connectedAgents[user.connectedAgents.length - 1];
    
    // --- START SIGNING LOGIC FOR AGENT IMAGE ---
    let signedPhotoUrl = activeAgent?.photoUrl;

    if (activeAgent?.photoUrl && activeAgent.photoUrl.includes('idrivee2.com')) {
      try {
        const fileKey = activeAgent.photoUrl.split('.com/')[1];
        const command = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
        });
        // Generate a 1-hour signed URL
        signedPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      } catch (err) {
        console.error("Signing failed", err);
      }
    }
    // --- END SIGNING LOGIC ---

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        isProfileComplete: user.isProfileComplete // Crucial for Frontend overlay
      },
      agent: activeAgent ? {
        ...activeAgent._doc,
        photoUrl: signedPhotoUrl // Send the signed version instead of raw
      } : null
    });
  } catch (err) {
    res.status(500).json({ message: "Session Error" });
  }
});

// index.js or server.js

app.put('/api/users/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    // Ensure DB connection
    await connectToDatabase();
    const { firstName, lastName, dob, city, state } = req.body;
    const updateData = {
      firstName,
      lastName,
      dob,
      city,
      state,
      isProfileComplete: true,
      isVerified: true
    };

    if (req.file) {
      // Sanitize filename to prevent URL issues
      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${req.user.id}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };
      await s3Client.send(new PutObjectCommand(uploadParams));
    updateData.photoUrl = `https://${process.env.IDRIVE_BUCKET_NAME}.idrivee2.com/${fileKey}`;
      
      console.log(`[Storage] Photo uploaded for user: ${req.user.id}`);
    }
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id, 
      updateData,
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: "User account not found" 
      });
    }

    // 5. Final Response
    res.json({ 
      success: true, 
      message: "Onboarding complete", 
      user: updatedUser 
    });

  } catch (err) {
    console.error("CRITICAL ONBOARDING ERROR:", err);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error during profile update" 
    });
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

app.put('/api/agents/update-profile', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();

    // 1. Find the Agent Document
    // Using req.user.id provided by your authenticateToken middleware
    const agent = await Agent.findById(req.user.id).select('+password');
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found" });
    }

    // 2. Extract Data from Body (Including Gender and DOB)
    const { 
      firstName, 
      lastName, 
      occupation, 
      program, 
      bio, 
      address, 
      gender,      // Added
      dob,         // Added (Date of Birth)
      oldPassword, 
      newPassword 
    } = req.body;

    // 3. Handle Password Security Update
    if (newPassword && newPassword.trim() !== "") {
      if (!oldPassword) {
        return res.status(400).json({ message: "Current password is required to set a new one" });
      }

      const isMatch = await bcrypt.compare(oldPassword, agent.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Current password incorrect. Security check failed." });
      }

      const salt = await bcrypt.genSalt(10);
      agent.password = await bcrypt.hash(newPassword, salt);
    }

    // 4. Update Profile Information
    // We use the "nullish coalescing" or logical OR to keep old data if the field is missing in req.body
    agent.firstName = firstName || agent.firstName;
    agent.lastName = lastName || agent.lastName;
    agent.occupation = occupation || agent.occupation;
    agent.program = program || agent.program;
    agent.bio = bio || agent.bio;
    agent.address = address || agent.address;
    agent.gender = gender || agent.gender; // Added
    agent.dob = dob || agent.dob;           // Added

    // 5. Save the Document
    await agent.save();

    console.log(`[SECURITY SYNC] Identity updated for: ${agent.email}`);
    
    // Create response object without the password
    const updatedData = agent.toObject();
    delete updatedData.password;

    res.json({
      success: true,
      message: "Identity, Gender, and Security synchronized successfully.",
      agent: updatedData
    });

  } catch (err) {
    console.error("Update Error:", err);
    res.status(500).json({ 
      success: false,
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

app.get('/api/agents/my-users', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    const agentId = req.user.id || req.user._id;

    if (!agentId) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid Agent session. Missing ID." 
      });
    }

    const users = await User.find({ 
      connectedAgents: agentId 
    })
    .select('firstName lastName email photoUrl city state isVerified isProfileComplete lastLogin lastActive createdAt')
    .sort({ lastActive: -1 })
    .lean();

const processedUsers = await Promise.all(users.map(async (user) => {
  let finalPhotoUrl = user.photoUrl;

  // Check for the specific problematic domain or any idrive string
  if (user.photoUrl && user.photoUrl.includes('idrivee2.com')) {
    try {
      // Extract the key correctly even if the domain is weird
      // Example: https://livechat.idrivee2.com/users/69d922... -> users/69d922...
      const urlParts = user.photoUrl.split('/');
      const userIndex = urlParts.indexOf('users');
      
      if (userIndex !== -1) {
        const rawKey = urlParts.slice(userIndex).join('/');
        const fileKey = decodeURIComponent(rawKey);

        const command = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: fileKey,
        });

        // This replaces the broken 'livechat.idrivee2.com' with the 
        // correct signed endpoint from your s3Client config
        finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      }
    } catch (s3Err) {
      console.error(`S3 Signing Error for user ${user._id}:`, s3Err.message);
      // Don't set to null here, or the frontend won't even try to render
      // Let it fall through so we can see the 'finalPhotoUrl' in the console
    }
  }

  const lastSeen = user.lastActive || user.lastLogin;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const isOnline = lastSeen && new Date(lastSeen) > fiveMinutesAgo;

  return {
    ...user,
    photoUrl: finalPhotoUrl,
    status: isOnline ? 'online' : 'offline'
  };
}));

    res.json({
      success: true,
      count: processedUsers.length,
      users: processedUsers
    });

  } catch (err) {
    console.error("CRITICAL ERROR FETCHING AGENT USERS:", err);
    res.status(500).json({ 
      success: false,
      message: "Internal server error while retrieving user list",
      error: err.message
    });
  }
});

// 4. Protected Dashboard
app.get('/api/portal/dashboard', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const agent = await Agent.findById(req.user.id).select('-password');
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ message: "Error fetching dashboard" });
  }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

export default app;