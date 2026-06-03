import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { connectToDatabase } from '../config/db.js';
import { getS3Client, getPrivateUrl, PutObjectCommand, GetObjectCommand } from '../config/s3.js';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Agent from '../models/Agent.js';
import User from '../models/User.js'; 


const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const flw = new Flutterwave(process.env.VITE_FLW_PUBLIC_KEY, process.env.VITE_FLW_SECRET_KEY);

// --- NODEMAILER CONFIG ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const getAgentModel = () => {
  return mongoose.models.Agent || Agent;
};


// 1. DYNAMIC TOKEN AUTHENTICATION MIDDLEWARE
export const authenticateToken = async (req, res, next) => {
  console.log("DEBUG AUTH - Headers:", req.headers.authorization);
  console.log("DEBUG AUTH - Cookies:", req.cookies, req.signedCookies);

  // Extract from incoming Authorization header string OR fall back to HTTP-only signed cookie configurations
  const token = req.headers['authorization']?.split(' ')[1] || req.signedCookies?.token;

  if (!token) {
    console.warn("DEBUG: Auth failed, no token found in headers or signed cookies.");
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    // Structural conversion to async/await evaluation syntax removes nested block execution scopes
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.id = decoded.id || decoded._id;

    // 🛡️ SECURITY FIX: Agent Session Isolation & Dual Login Verification Logic
    if (decoded.role === 'agent') {
      const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
      const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
      
      if (!agent) {
        return res.status(404).json({ success: false, message: "Agent profile match not found." });
      }

      // Check for dual login: Forces termination if a newer login generated an updated cluster state signature
      if (agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
        return res.status(403).json({ 
          success: false, 
          message: "Dual login detected across separate instances.", 
          reason: "dual_login",
          forceLogout: true 
        });
      }
      
      await AgentModel.findByIdAndUpdate(req.user.id, { $set: { lastActive: new Date() } });
    }

    // Admin Activity Logging Boundary
    if (decoded.role === 'admin' || decoded.role === 'superadmin') {
      const AdminModel = mongoose.models.Admin || mongoose.model('Admin');
      await AdminModel.findByIdAndUpdate(req.user.id, { $set: { lastLogin: new Date() } });
    }

    next();
  } catch (err) {
    console.error("DEBUG: Token verification failed:", err.message);
    
    // Distinguish between expired and structurally malformed signatures for precise client response triggers
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    
    return res.status(403).json({ success: false, message: "Invalid or expired token structure." });
  }
};

// 2. TIER 1: ADMINISTRATIVE AUTHORIZATION FILTER (Allows Admin AND Superadmin)
export const isAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
    return next();
  } 
  
  return res.status(403).json({ 
    success: false, 
    message: "Access denied: Administrative privileges required." 
  });
};

// =========================================================================
// 🛡️ TIER 2: SUPERADMIN ONLY MIDDLEWARE (System Root Operations Only)
// =========================================================================
export const requireSuperAdmin = (req, res, next) => {
  // STRICT VERIFICATION: Explicitly drops standard admins out from core cluster settings
  if (req.user && req.user.role === 'superadmin') {
    return next();
  }

  return res.status(403).json({ 
    success: false, 
    message: "Access Denied: Superadmin authorization required for this operation." 
  });
};

// --- 1. STAGE 1: AGENT REGISTRATION (INIT) ---
router.post('/register', upload.single('photo'), async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    const { 
      firstName, lastName, email, password, address, 
      occupation, program, bio, dob, gender, plan 
    } = req.body;

    // 1. INPUT PRESENTATION CHECK
    if (!email) {
      return res.status(400).json({ success: false, message: "Email required." });
    }

    const lowerEmail = email.toLowerCase().trim();
    let existingAgent = await AgentModel.findOne({ email: lowerEmail });

    // 🛡️ SECURITY FIX: OTP Throttling (Defends against mail gateway flooding)
    if (existingAgent?.otpExpires && existingAgent.otpExpires > Date.now()) {
      return res.status(429).json({ success: false, message: "Verification code already sent. Please wait." });
    }

    if (existingAgent?.isVerified) {
      return res.status(400).json({ success: false, message: "Account already verified." });
    }

    // 2. CRYPTO PASSWORD HANDLING
    let hashedPassword = existingAgent ? existingAgent.password : "";
    if (password && password.trim() !== "") {
      hashedPassword = await bcrypt.hash(password, 10);
    } else if (!existingAgent) {
      return res.status(400).json({ success: false, message: "Password is required for registration." });
    }

    // 3. SECURE UNIQUE SLUG GENERATION
    let finalSlug = existingAgent ? existingAgent.slug : "";
    if (!existingAgent) {
      const baseSlug = `${firstName || 'agent'}${lastName || ''}`.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      finalSlug = baseSlug;
      let counter = 1;
      while (await AgentModel.findOne({ slug: finalSlug })) {
        counter++;
        finalSlug = `${baseSlug}-${counter.toString().padStart(2, '0')}`;
      }
    }

    // 🛡️ SECURITY FIX: Photo Validation & S3 Object Key Sanitization
    let savedPhotoPath = existingAgent ? existingAgent.photoUrl : ""; 
    if (req.file) {
      // Enforce 2MB file size ceiling
      if (req.file.size > 2 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: "Photo too large. Maximum size allowed is 2MB." });
      }

      // Evict special character sequences out of original uploaded filename arrays
      const cleanFileName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-');
      const fileKey = `profiles/${Date.now()}-${cleanFileName}`;
      const bucketName = process.env.IDRIVE_BUCKET_NAME;

      await getS3Client().send(new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));

      const rawEndpoint = (process.env.IDRIVE_ENDPOINT || "").replace('https://', '');
      savedPhotoPath = `https://${bucketName}.${rawEndpoint}/${fileKey}`;
    }

    // 4. ATOMIC CODES GENERATION (Valid for 10 minutes)
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + (10 * 60 * 1000);

    // 5. DATA COALESCING PERSISTENCE
    if (existingAgent) {
      Object.assign(existingAgent, { 
        firstName: firstName ? firstName.trim() : existingAgent.firstName,
        lastName: lastName ? lastName.trim() : existingAgent.lastName,
        password: hashedPassword, 
        otp: otpCode, 
        otpExpires: otpExpiry, 
        photoUrl: savedPhotoPath,
        dob: dob || existingAgent.dob,
        gender: gender || existingAgent.gender,
        occupation: occupation !== undefined ? occupation : existingAgent.occupation,
        address: address !== undefined ? address : existingAgent.address,
        bio: bio !== undefined ? bio : existingAgent.bio,
        program: program !== undefined ? program : existingAgent.program,
        plan: plan || existingAgent.plan || "BASIC"
      });
      await existingAgent.save();
    } else {
      await AgentModel.create({
        firstName: (firstName || "Agent").trim(),
        lastName: (lastName || "").trim(),
        email: lowerEmail,
        password: hashedPassword,
        slug: finalSlug,
        photoUrl: savedPhotoPath,
        dob: dob || null,
        gender: gender || "",
        occupation: occupation || "",
        address: address || "",
        bio: bio || "",
        program: program || "",
        role: 'agent',
        status: 'pending',
        isVerified: false,
        isSubscribed: false,
        plan: plan || "BASIC",
        otp: otpCode,
        otpExpires: otpExpiry
      });
    }

    // 6. EMAIL DELIVERY SYSTEM
    const logoPath = path.join(process.cwd(), 'public', 'logo.png');
    try {
      await transporter.sendMail({
        from: `"ZingConnect Security" <${process.env.GMAIL_USER || process.env.EMAIL_USER}>`,
        to: lowerEmail,
        subject: "Your Verification Code",
        attachments: [{
          filename: 'logo.png',
          path: logoPath,
          cid: 'zinglogo'
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
                          Hello <strong>${firstName || 'Agent'}</strong>,<br>
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
      console.error("🔴 [Mailer Failure] Postponing email stack:", mailError.message);
    }

    return res.status(200).json({ success: true, message: "Verification code sent." });

  } catch (error) {
    // 🛡️ SECURITY FIX: Route intercept traces out to secure error tracking engine instead of leaking system data
    next(error);
  }
});

// --- 2. STAGE 2: VERIFY OTP ---
router.post('/verify-otp', async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const lowerEmail = email.toLowerCase().trim();
    const agent = await AgentModel.findOne({ email: lowerEmail });

    // 🛡️ SECURITY FIX: Unified validation comparison logic 
    // Prevents identity enumeration profiles by using a generic error response string
    if (!agent || agent.otp !== otp || (agent.otpExpires && agent.otpExpires < Date.now())) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired verification code." 
      });
    }

    // Clean verification status transitions
    agent.isVerified = true;
    agent.status = 'active';
    agent.otp = undefined;
    agent.otpExpires = undefined;
    await agent.save();
    
    if (!process.env.JWT_SECRET) {
      throw new Error("Security configuration error.");
    }

    // Sign payload token allocations
    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      success: true,
      token: token,
      slug: agent.slug,
      message: "Your profile is now live!"
    });

  } catch (err) {
    // Forward traces safely via central app intercept middleware
    next(err); 
  }
});

router.post('/login', async (req, res) => {
  try {
    // 🚀 CRITICAL FIX: Explicitly open the database connection tunnel first!
    await connectToDatabase();

    const AgentModel = getAgentModel();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const agent = await AgentModel.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!agent) return res.status(401).json({ success: false, message: "Invalid credentials" });
    
    if (!agent.isVerified) return res.status(403).json({ success: false, message: "Please verify your email first" });

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const newSessionId = crypto.randomUUID();
    agent.currentSessionId = newSessionId;
    await agent.save();

    const token = jwt.sign(
      { 
        id: agent._id, 
        slug: agent.slug, 
        role: 'agent',
        sessionId: newSessionId 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    return res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
      role: 'agent',
      isSubscribed: !!agent.isSubscribed, 
      plan: agent.plan || 'BASIC'
    });

  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Ensure the model is retrieved correctly using your helper
    const AgentModel = getAgentModel();
if (!AgentModel) throw new Error("Agent Model not initialized");

let agent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { lastActive: new Date() }, 
      { returnDocument: 'after' } 
    ).select('-password');
    
    if (!agent) {
      console.error(`Agent ID ${req.user.id} not found.`);
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // 2. Auto-lock logic for expired subscriptions
    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      console.log(`Auto-locking: Plan expired for ${agent.email}`);
      agent.isSubscribed = false;
      await agent.save();
    }

    // 3. Send clean JSON response
    res.json(agent);

  } catch (err) {
    // This detailed log will show up in your Vercel/Terminal logs
    console.error("DETAILED PROFILE ERROR:", err);
    
    // Returning JSON here prevents the "Unexpected token A" error on the frontend
    res.status(500).json({ 
      success: false, 
      message: "Profile fetch error", 
      error: err.message 
    });
  }
});

router.get('/profile/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();

    // 1. FETCH AGENT FIRST (Do not update yet)
    const agent = await AgentModel.findById(req.user.id);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent not found"
      });
    }

    // --- DUAL LOGIN SECURITY GATE ---
    if (req.user.sessionId && agent.currentSessionId && req.user.sessionId !== agent.currentSessionId) {
      return res.status(403).json({ 
        success: false, 
        message: "Session expired: Logged in from another device", 
        reason: "dual_login" 
      });
    }

    // 2. SAFE UPDATE: lastActive status
    agent.lastActive = new Date();
    
    // 3. CHECK EXPIRATIONS
    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
    }

    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
      agent.voicePackageActive = false;
    }

    await agent.save();

    // 4. HANDLE PHOTO SIGNING
      let finalPhotoUrl = await getPrivateUrl(agent.photoUrl);
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        const urlParts = agent.photoUrl.split('/');
        const profileIndex = urlParts.indexOf('profiles');
        
        if (profileIndex !== -1 && typeof GetObjectCommand !== 'undefined' && typeof s3Client !== 'undefined') {
          const fileKey = urlParts.slice(profileIndex).join('/');
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: decodeURIComponent(fileKey),
          });
          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (signErr) {
        console.error("Image Signing Failed:", signErr.message);
        finalPhotoUrl = agent.photoUrl; 
      }
    }

    if (!finalPhotoUrl) {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // 5. CALCULATE ONLINE STATUS
    const lastActiveDate = agent.lastActive || agent.createdAt;
    const isOnline = (now - new Date(lastActiveDate)) < 120000;

    // 6. Clean JSON Response
    res.json({
      success: true,
      agent: {
        _id: agent._id,
        email: agent.email || "",
        firstName: agent.firstName || "",
        lastName: agent.lastName || "",
        occupation: agent.occupation || "",
        program: agent.program || "",
        bio: agent.bio || "",
        gender: agent.gender || "", 
        dob: agent.dob || "",
        address: agent.address || "",
        photoUrl: finalPhotoUrl,
        slug: agent.slug || "",
        
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed, 
        subscriptionDate: agent.subscriptionDate || null,
        subscriptionAmount: agent.subscriptionAmount || 0,
        expiryDate: agent.expiryDate || null,
        paymentDetails: agent.paymentDetails || { amountNgn: 0, currency: "NGN" },

        // --- UPDATED VOICE IDENTITY FIELDS ---
        // We use the stored voiceId (which could be null for Natural) 
        // and include the list of voices they have actually paid for.
        voiceId: agent.voiceId, 
        unlockedVoiceIds: agent.unlockedVoiceIds || [], 
        voiceDisplayName: agent.voiceDisplayName || "",
        voicePackageActive: !!agent.voicePackageActive, 
        voicePackageExpiry: agent.voicePackageExpiry || null,

        status: isOnline ? 'online' : 'offline',
        lastActive: agent.lastActive
      }
    });

  } catch (err) {
    console.error("Profile Fetch Error:", err.stack);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error",
      error: err.message 
    });
  }
});
// This is the route the client/user calls to see Lawrence's profile
router.get('/agent-public-profile/:id', async (req, res) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    const agent = await AgentModel.findById(req.params.id).select('-password').lean();

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    const now = new Date();
    const lastActive = agent.lastActive || agent.createdAt;    
    const isOnline = lastActive && (now - new Date(lastActive)) < (2 * 60 * 1000);

    // --- PHOTO SIGNING (Same logic as your /me route) ---
    let finalPhotoUrl = agent.photoUrl;
    // ... insert your existing S3 signing logic here ...

    res.json({
      success: true,
      agent: {
        ...agent,
        photoUrl: finalPhotoUrl,
        status: isOnline ? 'online' : 'offline', 
        lastSeenText: isOnline ? 'Online' : 'Offline'
      }
    });

  } catch (err) {
    console.error("Public Profile Fetch Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// --- GET PUBLIC AGENT PROFILE (FOR USER DASHBOARD) ---
router.get('/agent-public-profile/:id', async (req, res) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    // 1. Fetch the agent by ID
    const agent = await AgentModel.findById(req.params.id).select('-password').lean();

    if (!agent) {
      return res.status(404).json({ 
        success: false, 
        message: "Agent not found" 
      });
    }
    const now = new Date();
    const lastActive = agent.lastActive || agent.createdAt;
    const isOnline = lastActive && (now - new Date(lastActive)) < (2 * 60 * 1000);
    let finalPhotoUrl = agent.photoUrl;
        if (agent.photoUrl && (agent.photoUrl.includes('idrivee2.com') || agent.photoUrl.includes('s3.'))) {
      try {
        const urlParts = agent.photoUrl.split('/');
        const profileIndex = urlParts.indexOf('profiles');
        
        if (profileIndex !== -1) {
          const fileKey = urlParts.slice(profileIndex).join('/');
          
          if (s3Client) {
            const command = new GetObjectCommand({
              Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
              Key: decodeURIComponent(fileKey),
            });
            
            finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
          }
        }
      } catch (signErr) {
        console.error(`Image Signing Failed for ${agent.firstName}:`, signErr.message);
        // Fallback is already the original photoUrl
      }
    }

    // If no photo at all, use a nice UI Avatar
    if (!finalPhotoUrl) {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=random&color=fff&size=128`;
    }

    // 4. GENERATE LAST SEEN TEXT
    let lastSeenDisplay = "Offline";
    if (isOnline) {
      lastSeenDisplay = "Online";
    } else if (lastActive) {
      const diffMins = Math.floor((now - new Date(lastActive)) / 60000);
      if (diffMins < 60) {
        lastSeenDisplay = `${diffMins}m ago`;
      } else if (diffMins < 1440) {
        lastSeenDisplay = `${Math.floor(diffMins / 60)}h ago`;
      } else {
        lastSeenDisplay = new Date(lastActive).toLocaleDateString();
      }
    }

    // 5. SEND RESPONSE
    res.json({
      success: true,
      agent: {
        ...agent,
        photoUrl: finalPhotoUrl,
        status: isOnline ? 'online' : 'offline', 
        lastSeenText: lastSeenDisplay
      }
    });

  } catch (err) {
    console.error("Public Profile Fetch Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error while fetching agent status" 
    });
  }
});

// This route is specifically for the setInterval pulse from the Agent Dashboard
router.post('/heartbeat', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { lastActive: new Date() }, 
      { new: true, select: 'lastActive' } // Only return what we need
    );

    if (!updatedAgent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    res.json({ 
      success: true, 
      lastActive: updatedAgent.lastActive 
    });

  } catch (err) {
    console.error("HEARTBEAT ERROR:", err);
    res.status(500).json({ success: false });
  }
});
// --- 4. UPDATE AGENT PLAN ---
router.post('/update-plan', authenticateToken, async (req, res) => {
  try {
    const AgentModel = getAgentModel();
    const { plan } = req.body;
    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id,
      { plan: plan },
      { new: true }
    ).select('-password');
    res.json({ success: true, plan: updatedAgent.plan });
  } catch (err) {
    res.status(500).json({ success: false, message: "Plan update failed" });
  }
});
// --- 5. VERIFY SUBSCRIPTION (FIXED RATE LOGIC + Expiry Calculation) ---
router.post('/verify', authenticateToken, async (req, res) => {
  const { transaction_id, plan, usdAmount } = req.body;
  const agentId = req.user.id;
  const AgentModel = getAgentModel();

  try {
    const currentRate = Number(process.env.USD_TO_NGN_RATE) || 1550;

    // 2. Verify with Flutterwave
    const response = await flw.Transaction.verify({ id: transaction_id });

    if (response.data.status === "successful") {
      const amountPaid = response.data.amount;
      const expectedNaira = usdAmount * currentRate;

      // Allow 2% fluctuation margin (Safety buffer)
      if (amountPaid >= (expectedNaira * 0.98)) {
        
        // 3. CALCULATE EXPIRY DATE
        const now = new Date();
        let expiry = new Date();

        if (plan === 'BASIC') {
          expiry.setMonth(now.getMonth() + 1); // 1 Month
        } else if (plan === 'GROWTH') {
          expiry.setMonth(now.getMonth() + 6); // 6 Months
        } else if (plan === 'PROFESSIONAL') {
          expiry.setFullYear(now.getFullYear() + 1); // 1 Year
        }

        const updatedAgent = await AgentModel.findByIdAndUpdate(
          agentId, 
          {
            $set: {
              isSubscribed: true,
              plan: plan,
              subscriptionDate: now,
              subscriptionAmount: usdAmount, // Store the USD cost
              expiryDate: expiry,
              expiryNotificationSent: false, // Reset warning tracker for new sub
              lastTransactionId: transaction_id,
              // Updated to match your schema's paymentDetails field
              paymentDetails: {
                amountNgn: amountPaid,
                rateUsed: currentRate,
                currency: "NGN"
              }
            }
          }, 
          { new: true }
        ).select('-password');

        console.log(`[FIXED RATE: ${currentRate}] Subscription ACTIVATED for: ${updatedAgent.email}`);

        return res.status(200).json({ 
          success: true, 
          message: "Subscription activated. Secure node online.", 
          agent: updatedAgent 
        });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient amount. Expected approx ₦${expectedNaira.toLocaleString()}` 
        });
      }
    } else {
      return res.status(400).json({ success: false, message: "Transaction failed at gateway." });
    }
  } catch (error) {
    console.error("Verification Error:", error);
    res.status(500).json({ success: false, error: "System verification failed" });
  }
});

// --- 6. UPDATE AGENT PROFILE & SECURITY (STABILIZED) ---
router.put('/update-profile', authenticateToken, async (req, res) => {
  try {
    const AgentModel = getAgentModel();

    // 1. Find the Agent Document with password for comparison
    // We select('+password') because the schema usually hides it by default
    const agent = await AgentModel.findById(req.user.id).select('+password');
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found" });
    }

    // 2. Extract Data from Body
    const { 
      firstName, 
      lastName, 
      occupation, 
      program, 
      bio, 
      gender, 
      dob, 
      address, 
      voiceId, 
      voiceDisplayName, 
      voiceSettings,
      oldPassword, 
      newPassword 
    } = req.body;

    // 3. Handle Password Security Update
    if (newPassword && newPassword.trim() !== "") {
      if (!oldPassword) {
        return res.status(400).json({ 
          success: false, 
          message: "Current password is required to authorize security changes." 
        });
      }

      const isMatch = await bcrypt.compare(oldPassword, agent.password);
      if (!isMatch) {
        return res.status(401).json({ 
          success: false, 
          message: "Current password incorrect. Security sync blocked." 
        });
      }

      const salt = await bcrypt.genSalt(10);
      agent.password = await bcrypt.hash(newPassword, salt);
    }

    // 4. Update Profile Information (General)
    agent.firstName = firstName || agent.firstName;
    agent.lastName = lastName || agent.lastName;
    agent.occupation = occupation || agent.occupation;
    agent.program = program || agent.program;
    agent.bio = bio || agent.bio;
    agent.gender = gender || agent.gender;
    agent.dob = dob || agent.dob;
    agent.address = address || agent.address;
    
    // 5. Update Voice Settings
    if (voiceId !== undefined) agent.voiceId = voiceId;
    if (voiceDisplayName !== undefined) agent.voiceDisplayName = voiceDisplayName;
    if (voiceSettings !== undefined) {
      agent.voiceSettings = { 
        ...agent.voiceSettings, 
        ...voiceSettings 
      };
    }

    // Save changes to MongoDB
    await agent.save();

    console.log(`[SECURITY] Profile & Voice synchronized for: ${agent.email}`);

    // 6. PREPARE THE FULL RESPONSE
    // This ensures your React frontend doesn't lose the NGN amount or dates
    const updatedAgent = agent.toObject();
    delete updatedAgent.password;

    res.json({
      success: true,
      message: "Identity, Voice, and Security synchronized successfully.",
      agent: {
        ...updatedAgent,
        // Explicitly ensuring these reach the frontend cards
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed,
        subscriptionDate: agent.subscriptionDate || null, // For Activation Date card
        expiryDate: agent.expiryDate || null,
        // For the ₦ Amount display
        paymentDetails: agent.paymentDetails || { amountNgn: 0, currency: "NGN" }
      }
    });

  } catch (err) {
    console.error("Update Profile Error:", err.stack);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error during profile sync",
      error: err.message 
    });
  }
});

router.put('/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    await connectToDatabase();
    
    // Safety check for user identity
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: No user ID found" });
    }

    const { firstName, lastName, dob, gender, city, state, phone } = req.body;
    
    const updateData = {
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      phone: phone?.toString().trim(),
      dob,
      gender: gender ? gender.toLowerCase().trim() : "", 
      city: city?.trim(),
      state: state?.trim(),
      isProfileComplete: true,
      isVerified: true
    };

    if (req.file) {
      const s3Client = getS3Client(); 
      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${userId}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));      
      updateData.photoUrl = fileKey; 
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user: updatedUser });

  } catch (err) {
    console.error("ONBOARDING ERROR:", err.message);
    // Return detailed error only if it's a validation error, otherwise generic
    res.status(500).json({ 
        success: false, 
        message: err.name === 'ValidationError' ? err.message : "Internal server error during onboarding" 
    });
  }
});

// --- GET AGENT'S CONNECTED USERS (ROUTER VERSION) ---
router.get('/my-users', authenticateToken, async (req, res) => {
  // Clear cache to ensure real-time status updates
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    // 🚀 1. Enforce active database connection tunnel instantly
    await connectToDatabase();
    
    // Get agent ID from the token (provided by authenticateToken middleware)
    const agentId = req.user?.id || req.user?._id;

    if (!agentId) {
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized: Missing agent session metadata." 
      });
    }

    // 🚀 2. SERVERLESS SAFEGUARD: Dynamically resolve User model to prevent context loss
    const ActiveUserModel = mongoose.models.User || User;

    // Fetch users linked to this agent (Keeping all select fields intact for layout)
    const users = await ActiveUserModel.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl city state isVerified isProfileComplete lastLogin lastActive createdAt')
      .sort({ lastActive: -1 })
      .lean();

    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      // 3. Handle S3 Image Signing (IDrive e2 / AWS S3)
      if (user.photoUrl && typeof user.photoUrl === 'string') {
        try {
          let fileKey = user.photoUrl;

          // If the DB stores a full URL, strip it to get the Key
          if (fileKey.includes('.com/')) {
            fileKey = fileKey.split('.com/')[1].split('?')[0];
          }
          
          // FIX: Clean leading slashes and safely handle spaces/special characters
          let cleanKey = fileKey.startsWith('/') ? fileKey.slice(1) : fileKey;
          
          // Decode first to prevent double-encoding, then decode raw spaces if any exist safely
          cleanKey = decodeURIComponent(cleanKey);

          // 🚀 4. Use constructors safely since they are imported at the top of your router file
          const client = getS3Client(); 
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: cleanKey, 
          });

          finalPhotoUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
        } catch (s3Err) {
          console.error(`[S3 Error] Photo failed for ${user.email}:`, s3Err.message);
        }
      }

      // 5. Fallback to UI Avatars if signing fails or photo doesn't exist
      if (!finalPhotoUrl) {
        const nameParam = encodeURIComponent(`${user.firstName || 'U'} ${user.lastName || ''}`);
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${nameParam}&background=random&color=fff&size=128`;
      }

      // 6. Presence Calculation
      const lastSeen = user.lastActive || user.lastLogin;
      const now = new Date();
      const isOnline = lastSeen && (now - new Date(lastSeen)) < (5 * 60 * 1000);

      // 7. Human-Readable Status
      let lastSeenText = "Offline";
      if (lastSeen) {
        const diffMins = Math.floor((now - new Date(lastSeen)) / 60000);
        
        if (isOnline) {
          lastSeenText = "Online";
        } else if (diffMins < 60) {
          lastSeenText = `${diffMins}m ago`;
        } else if (diffMins < 1440) {
          lastSeenText = `${Math.floor(diffMins / 60)}h ago`;
        } else {
          lastSeenText = new Date(lastSeen).toLocaleDateString();
        }
      }

      return {
        ...user,
        photoUrl: finalPhotoUrl,
        avatar: finalPhotoUrl,     // Fallback frontend object data property
        avatarUrl: finalPhotoUrl,  // Fallback frontend object data property
        status: isOnline ? 'online' : 'offline',
        lastSeenText: lastSeenText
      };
    }));

    return res.json({
      success: true,
      count: processedUsers.length,
      users: processedUsers
    });

  } catch (err) {
    console.error("AGENT USERS FETCH ERROR:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Server failed to retrieve user list",
      error: err.message
    });
  }
});

// --- GET USER'S CURRENT ACTIVE SESSION ENGINE ---
router.get('/my-session', authenticateToken, async (req, res) => {
  try {
    // 🚀 1. Enforce active database connection tunnel instantly
    await connectToDatabase();
    
    // Get user ID straight from the verified token middleware
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "No secure user context found." });
    }

    // Update active heartbeat marker and populate connected agents list
    const user = await User.findByIdAndUpdate(
      userId, 
      { lastActive: new Date() },
      { returnDocument: 'after' } 
    ).populate({
      path: 'connectedAgents',
      select: 'firstName lastName photoUrl occupation program bio slug lastActive gender dob'
    });

    if (!user) return res.status(404).json({ message: "User account not found" });

    // Track down the last connected agent profile block
    let activeAgent = user.connectedAgents && user.connectedAgents.length > 0 
      ? user.connectedAgents[user.connectedAgents.length - 1] 
      : null;
    
    let isOnline = false;
    let lastSeenDisplay = "Offline";
    let signedPhotoUrl = null;

    if (activeAgent) {
      const freshAgent = await Agent.findById(activeAgent._id).lean();
      
      if (freshAgent) {
        const now = new Date();
        const lastActive = freshAgent.lastActive || freshAgent.createdAt;
        isOnline = lastActive && (now - new Date(lastActive)) < 120000;

        if (isOnline) {
          lastSeenDisplay = "Online";
        } else if (lastActive) {
          const diffMins = Math.floor((now - new Date(lastActive)) / 60000);
          if (diffMins < 60) {
            lastSeenDisplay = `Last seen ${diffMins}m ago`;
          } else if (diffMins < 1440) {
            lastSeenDisplay = `Last seen ${Math.floor(diffMins / 60)}h ago`;
          } else {
            lastSeenDisplay = "Offline";
          }
        }
      }

      // 🚀 2. Handle Cloud Infrastructure Image Signing (IDrive e2 / AWS S3)
      if (activeAgent.photoUrl && typeof activeAgent.photoUrl === 'string') {
        try {
          let fileKey = activeAgent.photoUrl;

          if (fileKey.includes('.com/')) {
            fileKey = fileKey.split('.com/')[1].split('?')[0];
          }
          
          let cleanKey = fileKey.startsWith('/') ? fileKey.slice(1) : fileKey;
          cleanKey = decodeURIComponent(cleanKey);

          const client = getS3Client(); 
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: cleanKey, 
          });

          signedPhotoUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
        } catch (s3Err) {
          console.error(`[S3 Session Error] Signing failed for agent image:`, s3Err.message);
        }
      }
    }
    if (!signedPhotoUrl && activeAgent) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(activeAgent.firstName)}+${encodeURIComponent(activeAgent.lastName)}&background=0D1117&color=fff&size=128`;
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        isProfileComplete: user.isProfileComplete,
        lastActive: user.lastActive
      },
      agent: activeAgent ? {
        ...(activeAgent.toObject ? activeAgent.toObject() : activeAgent),
        photoUrl: signedPhotoUrl,
        status: isOnline ? 'online' : 'offline',
        lastSeenText: lastSeenDisplay
      } : null
    });

  } catch (err) {
    console.error("Session Processing Error:", err);
    res.status(500).json({ message: "Session Error", error: err.message });
  }
});

router.post('/unlock-voice-package', authenticateToken, async (req, res) => {
  const { transactionId, voiceId, duration } = req.body;

  try {
    const Agent = getAgentModel();
    const response = await flw.Transaction.verify({ id: transactionId });
    if (response.data.status === "successful") {
      let daysToAdd = 30;
      if (duration === '6 Months Identity') daysToAdd = 180;
      if (duration === '1 Year Identity') daysToAdd = 365;

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysToAdd);

      // 3. Map Voice IDs to Display Names
      const voiceNames = {
       'nPczCjzB2QC9zZ6ULpFM': 'Natural Professional',
      'auq43ws1oslv0tO4BDa7': 'Adam Stone',
      'EST9Ui6982FZPSi7gCHi': 'Elise VP',
      'DLsHlh26Ugcm6ELvS0qi': 'Ms Walker'
      };

      // 4. Update Agent Document with INDIVIDUAL unlock logic
      const updatedAgent = await Agent.findByIdAndUpdate(
        req.user.id,
        {
          $addToSet: { 
            unlockedVoiceIds: voiceId  // Adds this specific ID to the array if it's not there
          },
          $set: {
            voicePackageActive: true, 
            voicePackageExpiry: expiryDate,
            voicePackageLastPaid: new Date(),
            voiceId: voiceId, // Set the current active voice to the one just bought
            voiceDisplayName: voiceNames[voiceId] || "Elite Voice",
            lastTransactionId: transactionId 
          }
        },
        { new: true }
      ).select('-password');

      if (!updatedAgent) {
        return res.status(404).json({ success: false, message: "Agent account not found." });
      }

      return res.status(200).json({
        success: true,
        message: `Congratulations! ${voiceNames[voiceId] || 'Your voice'} has been activated.`,
        expiry: expiryDate,
        agent: updatedAgent
      });

    } else {
      return res.status(400).json({ success: false, message: "Flutterwave verification failed." });
    }
  } catch (error) {
    console.error("Voice Unlock Router Error:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Server error during voice activation.",
      error: error.message 
    });
  }
});

export default router;