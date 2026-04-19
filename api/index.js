console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import jwt from 'jsonwebtoken'; 
import bcrypt from 'bcryptjs';
import multer from 'multer';
import nodemailer from 'nodemailer';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
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

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.post('/api/agents/register-init', upload.single('photo'), async (req, res) => {
  console.log("Registration Stage 1 (Complete Fields) started...");

  try {
    await connectToDatabase();
    const Agent = getAgentModel(); // Ensure model is initialized

    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !email || !password) {
      return res.status(400).json({ success: false, message: "Required fields missing" });
    }

    const lowerEmail = email.toLowerCase().trim();

    // --- 1. CHECK IF EMAIL EXISTS & VERIFICATION STATUS ---
    let existingAgent = await Agent.findOne({ email: lowerEmail });

    if (existingAgent && existingAgent.isVerified) {
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered and verified. Please login." 
      });
    }

    // --- 2. PASSWORD HASHING ---
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // --- 3. SLUG GENERATION ---
    let finalSlug = existingAgent ? existingAgent.slug : "";
    if (!existingAgent) {
      const cleanFirst = firstName.trim().replace(/[^a-zA-Z0-9]/g, '');
      const cleanLast = (lastName || "").trim().replace(/[^a-zA-Z0-9]/g, '');
      const baseSlug = `${cleanFirst}${cleanLast}`.toLowerCase() || "agent";
      
      finalSlug = baseSlug;
      let counter = 1;
      while (await Agent.findOne({ slug: finalSlug })) {
        counter++;
        finalSlug = `${baseSlug}-${counter}`;
      }
    }

    // --- 4. PHOTO UPLOAD (IDRIVE) ---
    let savedPhotoPath = existingAgent ? existingAgent.photoUrl : "";
    if (req.file) {
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
        
        const rawEndpoint = (process.env.IDRIVE_ENDPOINT || "").replace('https://', '');
        savedPhotoPath = `https://${bucketName}.${rawEndpoint}/${fileKey}`;
      } catch (uploadErr) {
        console.error("IDRIVE UPLOAD FAILED:", uploadErr.message);
      }
    }

    // --- 5. OTP GENERATION ---
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000;

    // --- 6. CREATE OR UPDATE DOCUMENT ---
    if (existingAgent) {
      // Update the unverified existing record
      existingAgent.firstName = firstName.trim();
      existingAgent.lastName = (lastName || "").trim();
      existingAgent.password = hashedPassword;
      existingAgent.dob = req.body.dob;
      existingAgent.gender = req.body.gender;
      existingAgent.occupation = req.body.occupation;
      existingAgent.address = req.body.address;
      existingAgent.bio = req.body.bio || "";
      existingAgent.program = req.body.program || "";
      existingAgent.photoUrl = savedPhotoPath;
      existingAgent.otp = otpCode;
      existingAgent.otpExpires = otpExpiry;
      existingAgent.plan = req.body.plan || "BASIC";
      
      await existingAgent.save();
    } else {
      // Create new record
      const newAgent = new Agent({
        firstName: firstName.trim(),
        lastName: (lastName || "").trim(),
        email: lowerEmail,
        password: hashedPassword,
        dob: req.body.dob,
        gender: req.body.gender,
        occupation: req.body.occupation,
        address: req.body.address,
        bio: req.body.bio || "",
        program: req.body.program || "",
        slug: finalSlug,
        photoUrl: savedPhotoPath,
        role: 'agent',
        status: 'pending',
        isVerified: false,
        otp: otpCode,
        otpExpires: otpExpiry,
        isSubscribed: false,
        plan: req.body.plan || "BASIC"
      });
      await newAgent.save();
    }

   const logoPath = path.join(process.cwd(), 'public', 'logo.png');

// 2. Debugging: This will log to your console if the path is wrong before sending the mail
if (!fs.existsSync(logoPath)) {
    console.error(`❌ CRITICAL: Logo not found at ${logoPath}`);
}

try {
    await transporter.sendMail({
        from: `"ZingConnect Security" <${process.env.EMAIL_USER}>`,
        to: lowerEmail,
        subject: "Your Verification Code",
        attachments: [{
            filename: 'logo.png',
            path: logoPath,
            cid: 'zinglogo' // Must match the <img src="cid:zinglogo"> below
        }],
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              @media only screen and (max-width: 600px) {
                .container { width: 100% !important; border-radius: 0 !important; }
                .otp-box { font-size: 24px !important; letter-spacing: 4px !important; }
              }
            </style>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="center" style="padding: 40px 10px;">
                  <table class="container" role="presentation" width="500" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                    <tr>
                      <td align="center" style="padding: 30px 40px 10px 40px;">
                        <img src="cid:zinglogo" alt="ZingConnect" width="160" style="display: block; border: 0; outline: none; text-decoration: none;">
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 20px 40px 40px 40px; text-align: center;">
                        <h2 style="color: #111827; font-size: 22px; font-weight: 700; margin: 0 0 16px 0;">Verify Your Account</h2>
                        <p style="color: #4b5563; font-size: 15px; line-height: 24px; margin: 0 0 24px 0;">
                          Hello <strong>${firstName}</strong>,<br>
                          Welcome to ZingConnect! Use the secure verification code below to finalize your agent profile.
                        </p>
                        <div class="otp-box" style="background-color: #eff6ff; border: 2px dashed #bfdbfe; color: #2563eb; padding: 20px; text-align: center; font-size: 32px; font-weight: 800; letter-spacing: 6px; border-radius: 12px; margin-bottom: 24px;">
                          ${otpCode}
                        </div>
                        <p style="color: #9ca3af; font-size: 13px; line-height: 20px; margin: 0;">
                          This code is valid for <strong>10 minutes</strong>.<br>
                          If you didn't request this, you can safely ignore this email.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="background-color: #f3f4f6; padding: 20px 40px; text-align: center;">
                        <p style="color: #6b7280; font-size: 12px; margin: 0;">
                          &copy; ${new Date().getFullYear()} ZingConnect Protocol. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `
    });
} catch (mailError) {
    console.error("Email Delivery Failed:", mailError);
}

    res.status(200).json({ success: true, message: "Initial registration success. OTP sent." });

  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Internal Server Error during registration." 
    });
  }
});

// --- STAGE 2: VERIFY OTP ---
app.post('/api/agents/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  try {
    await connectToDatabase();
    const agent = await Agent.findOne({ 
      email: email.toLowerCase().trim(),
      otp: otp,
      otpExpires: { $gt: Date.now() } // $gt means "Greater Than" current time
    });

    if (!agent) {
      return res.status(400).json({ 
        success: false, 
        message: "The code is invalid or has expired. Please request a new one." 
      });
    }
    agent.isVerified = true;
    agent.status = 'active';
    
    // 3. Cleanup: Remove OTP data so the same code can't be used twice
    agent.otp = undefined; 
    agent.otpExpires = undefined;
    
    await agent.save();
    const token = jwt.sign(
      { id: agent._id, slug: agent.slug }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );
    res.status(200).json({ 
      success: true, 
      token: token, 
      slug: agent.slug, 
      message: "Your profile is now live!" 
    });

  } catch (err) {
    console.error("OTP Verification Error:", err);
    res.status(500).json({ success: false, message: "Internal server error during verification." });
  }
});

app.post('/api/agents/login', async (req, res) => {
  try {
    await connectToDatabase();
    
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    // 1. Find agent and explicitly include password
    const agent = await Agent.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!agent) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // 2. NEW: CHECK VERIFICATION STATUS
    // If the agent hasn't verified their OTP, block the login
    if (agent.isVerified === false) {
      return res.status(403).json({ 
        success: false, 
        message: "Account not verified. Please check your email for the OTP code.",
        needsVerification: true // Helpful hint for the frontend
      });
    }

    // 3. Compare Password
    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // 4. JWT Generation
    const token = jwt.sign(
      { 
        id: agent._id, 
        slug: agent.slug, 
        role: 'agent' 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // 5. Final Payload
    res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
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
        console.log("Generating URL for Key:", fileKey);

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
      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${req.user.id}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));

      // FIX: Store ONLY the key. 
      // Do not store the https:// domain.
      updateData.photoUrl = fileKey; 
      
      console.log(`[Storage] Photo uploaded for user: ${req.user.id} with key: ${fileKey}`);
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    await connectToDatabase();
    
    const agentId = req.user.id || req.user._id;

    if (!agentId) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid Agent session. Missing ID." 
      });
    }

    const users = await User.find({ connectedAgents: agentId })
      .select('firstName lastName email photoUrl city state isVerified isProfileComplete lastLogin lastActive createdAt')
      .sort({ lastActive: -1 })
      .lean();

    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      if (user.photoUrl && typeof user.photoUrl === 'string') {
        try {
          let fileKey = user.photoUrl;

          if (user.photoUrl.includes('users/')) {
            const urlParts = user.photoUrl.split('users/');
            const rawFileName = urlParts[urlParts.length - 1].split('?')[0]; 
            fileKey = `users/${decodeURIComponent(rawFileName)}`;
          }

          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: fileKey,
          });

          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        } catch (s3Err) {
          console.error(`S3 Signing Error for user ${user._id}:`, s3Err.message);
        }
      }

      if (!finalPhotoUrl) {
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=random&color=fff&size=128`;
      }

      const lastSeen = user.lastActive || user.lastLogin;
      const isOnline = lastSeen && new Date(lastSeen) > new Date(Date.now() - 5 * 60 * 1000);

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