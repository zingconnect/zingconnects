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
import { getS3Client, getPrivateUrl, PutObjectCommand } from '../config/s3.js';
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
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
};

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access Denied" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid Token" });
    
    req.user = decoded; 
    req.user.id = decoded.id || decoded._id;

    try {
      if (decoded.role === 'agent') {
        const AgentModel = mongoose.models.Agent || mongoose.model('Agent'); 
        const agent = await AgentModel.findById(req.user.id).select('currentSessionId lastActive');
        
        if (agent && agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
          return res.status(401).json({ success: false, message: "Session Mismatch", forceLogout: true });
        }
        if (agent) {
          agent.lastActive = new Date();
          await agent.save();
        }
      }
      if (decoded.role === 'admin') {
        const AdminModel = mongoose.models.Admin || mongoose.model('Admin');
        await AdminModel.findByIdAndUpdate(req.user.id, { lastLogin: new Date() });
      }

      next();
    } catch (dbErr) {
      console.error("Auth DB Error:", dbErr);
      return res.status(500).json({ message: "Internal Auth Error" });
    }
  });
};

export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, message: "Access denied: Admins only" });
  }
};


// --- 1. STAGE 1: AGENT REGISTRATION (INIT) ---
router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    await connectToDatabase();
    
const AgentModel = getAgentModel();
    const { 
      firstName, lastName, email, password, address, 
      occupation, program, bio, dob, gender, plan 
    } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required." });
    }

    const lowerEmail = email.toLowerCase().trim();

    // 1. CHECK IF EMAIL EXISTS & VERIFICATION STATUS
    let existingAgent = await AgentModel.findOne({ email: lowerEmail });

    if (existingAgent && existingAgent.isVerified) {
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered. Please login." 
      });
    }
    let hashedPassword = existingAgent ? existingAgent.password : "";

    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    } else if (!existingAgent) {
      return res.status(400).json({ success: false, message: "Password is required for registration." });
    }
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

    // 4. PHOTO UPLOAD TO IDRIVE E2
    let savedPhotoPath = existingAgent ? existingAgent.photoUrl : ""; 
    if (req.file) {
      try {
        const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
        const fileKey = `profiles/${fileName}`;
        const bucketName = process.env.IDRIVE_BUCKET_NAME || "livechat";
      await getS3Client().send(new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
}));
        const rawEndpoint = (process.env.IDRIVE_ENDPOINT || "").replace('https://', '');
        savedPhotoPath = `https://${bucketName}.${rawEndpoint}/${fileKey}`;
      } catch (uploadError) {
        console.error("Image Upload Failed:", uploadError);
      }
    }

    // 5. OTP GENERATION (6 Digits)
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 Minutes

    // 6. SAVE OR UPDATE AGENT
    if (existingAgent) {
      // UPDATE existing unverified agent - only update fields if they are sent
      if (firstName) existingAgent.firstName = firstName.trim();
      if (lastName) existingAgent.lastName = lastName.trim();
      
      existingAgent.password = hashedPassword; // Either the new hash or the old one
      existingAgent.address = address || existingAgent.address || "";
      existingAgent.occupation = occupation || existingAgent.occupation || "";
      existingAgent.program = program || existingAgent.program || "";
      existingAgent.bio = bio || existingAgent.bio || "";
      existingAgent.dob = dob || existingAgent.dob;
      existingAgent.gender = gender || existingAgent.gender;
      existingAgent.photoUrl = savedPhotoPath;
      existingAgent.otp = otpCode;
      existingAgent.otpExpires = otpExpiry;
      existingAgent.plan = plan || existingAgent.plan || 'BASIC';
      
      await existingAgent.save();
      console.log("Existing unverified agent updated with new OTP.");
    } else {
      // CREATE brand new agent
      const newAgent = new AgentModel({
        firstName: firstName.trim(),
        lastName: (lastName || "").trim(),
        email: lowerEmail,
        password: hashedPassword,
        address: address || "",
        occupation: occupation || "",
        program: program || "",
        bio: bio || "",
        dob,
        gender,
        slug: finalSlug,
        photoUrl: savedPhotoPath,
        plan: plan || 'BASIC',
        role: 'agent',
        status: 'pending',
        isVerified: false,
        otp: otpCode,
        otpExpires: otpExpiry
      });
      await newAgent.save();
      console.log("New agent created successfully.");
    }

    // 7. EMAIL DELIVERY
    const logoPath = path.join(process.cwd(), 'public', 'logo.png');

    try {
        await transporter.sendMail({
            from: `"ZingConnect Security" <${process.env.EMAIL_USER}>`,
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
        console.error("Email Delivery Failed:", mailError);
    }

    res.status(200).json({ 
      success: true, 
      message: "Registration initiated. Please check your email for the OTP." 
    });
    
  } catch (error) {
    console.error("Registration Logic Error:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "An unexpected error occurred during registration." 
    });
  }
});

// --- 2. STAGE 2: VERIFY OTP ---
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  try {
    await connectToDatabase();
    
const AgentModel = getAgentModel();
if (!AgentModel) throw new Error("Agent Model not initialized");
    if (!email || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: "Email and verification code are required." 
      });
    }

  const agent = await AgentModel.findOne({ 
      email: email.toLowerCase().trim(),
      otp: otp,
      otpExpires: { $gt: Date.now() }
    });

    if (!agent) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired verification code. Please try again." 
      });
    }

    // 4. Update agent status and clear OTP fields
    agent.isVerified = true;
    agent.status = 'active';
    agent.otp = undefined; 
    agent.otpExpires = undefined;
    
    await agent.save();

    // 5. Check if JWT_SECRET exists to avoid signing errors
    if (!process.env.JWT_SECRET) {
        console.error("JWT_SECRET is missing in environment variables.");
        throw new Error("Server configuration error.");
    }

    // 6. Generate access token
    const token = jwt.sign(
      { 
        id: agent._id, 
        slug: agent.slug, 
        role: 'agent' 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    // 7. Success Response
    res.status(200).json({ 
      success: true, 
      token, 
      slug: agent.slug,
      message: "Account verified successfully!" 
    });

  } catch (err) {
    console.error("OTP VERIFICATION CRASH:", err);
    res.status(500).json({ 
      success: false, 
      message: "Verification failed due to a server error.",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// --- 3. AGENT LOGIN ---
router.post('/login', async (req, res) => {
  try {
    const AgentModel = getAgentModel();
    if (!AgentModel) throw new Error("Agent Model not initialized");
    const { email, password } = req.body;

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

    res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
      role: 'agent',
      isSubscribed: !!agent.isSubscribed, 
      plan: agent.plan || 'BASIC'
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
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
    // 1. Ensure DB connection (Vital for Vercel Serverless)
    await connectToDatabase();

    const { firstName, lastName, dob, gender, city, state, phone } = req.body;

    // 2. Prepare data with Enum fix (Force lowercase to match User Schema)
    const updateData = {
      firstName,
      lastName,
      dob,
      phone,
      gender: gender ? gender.toLowerCase().trim() : "", 
      city,
      state,
      isProfileComplete: true,
      isVerified: true
    };

    if (req.file) {
      // 3. GET THE CLIENT (This was likely your 500 error cause)
      const s3Client = getS3Client(); 

      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${req.user.id}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "",
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };
      await s3Client.send(new PutObjectCommand(uploadParams));      
      updateData.photoUrl = fileKey; 
      
      console.log(`[Storage] Photo stored for User ${req.user.id}: ${fileKey}`);
    }
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id, 
      updateData,
      { new: true, runValidators: true } 
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ 
      success: true, 
      message: "Profile initialized successfully",
      user: updatedUser 
    });

  } catch (err) {
    console.error("ONBOARDING ERROR:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Server error during profile update",
      details: err.message // Temporary: remove this once you confirm it's fixed
    });
  }
});

// --- GET AGENT'S CONNECTED USERS ---
router.get('/my-users', authenticateToken, async (req, res) => {
  // Clear cache to ensure real-time status updates
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    await connectToDatabase();
    
    // Get agent ID from the token (provided by authenticateToken middleware)
    const agentId = req.user?.id || req.user?._id;

    if (!agentId) {
      return res.status(401).json({ 
        success: false, 
        message: "Unauthorized: Missing agent session metadata." 
      });
    }

    // 1. Fetch users linked to this agent
    const users = await User.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl city state isVerified isProfileComplete lastLogin lastActive createdAt')
      .sort({ lastActive: -1 })
      .lean();

    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      // 2. Handle S3 Image Signing (IDrive e2 / AWS S3)
      if (user.photoUrl && typeof user.photoUrl === 'string') {
        try {
          let fileKey = user.photoUrl;

          // Clean up URL to get the raw S3 Key
          if (user.photoUrl.includes('users/')) {
            const urlParts = user.photoUrl.split('users/');
            const rawFileName = urlParts[urlParts.length - 1].split('?')[0]; 
            fileKey = `users/${decodeURIComponent(rawFileName)}`;
          }

          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: fileKey,
          });

          // s3Client must be imported or available in this scope
          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        } catch (s3Err) {
          console.error(`[S3 Error] ${user.email}:`, s3Err.message);
        }
      }

      // 3. Fallback to Avatar if photo doesn't exist
      if (!finalPhotoUrl) {
        const initials = `${user.firstName || 'U'}+${user.lastName || ''}`;
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${initials}&background=random&color=fff&size=128`;
      }

      // 4. Presence Calculation (Online if active in last 2 minutes)
      const lastSeen = user.lastActive || user.lastLogin;
      const now = new Date();
      const isOnline = lastSeen && (now - new Date(lastSeen)) < (2 * 60 * 1000);

      // 5. Human-Readable Status
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
        status: isOnline ? 'online' : 'offline',
        lastSeenText: lastSeenText
      };
    }));

    res.json({
      success: true,
      count: processedUsers.length,
      users: processedUsers
    });

  } catch (err) {
    console.error("AGENT USERS FETCH ERROR:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server failed to retrieve user list",
      error: err.message
    });
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