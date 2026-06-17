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
import Message from '../models/Message.js'; // 👈 ADD THIS LINE
import { authenticateToken } from '../middlewares/auth.js'; // Ensure the path matches your folder structure


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

// utils/cache.js
export const getCachedData = async (redisClient, key) => {
  if (!redisClient?.isOpen) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`Cache Read Error [${key}]:`, err.message);
    return null;
  }
};

export const setCachedData = async (redisClient, key, data, ttl = 300) => {
  if (!redisClient?.isOpen) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (err) {
    console.error(`Cache Write Error [${key}]:`, err.message);
  }
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

router.post('/verify-otp', async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    const { 
      email, otp, deviceId, registrationId, identityKey, 
      signedPreKey, preKeys, isNewRegistration 
    } = req.body;

    if (!email || !otp || !deviceId) {
      return res.status(400).json({ success: false, message: "Required fields missing." });
    }

    const lowerEmail = email.toLowerCase().trim();
    const agent = await AgentModel.findOne({ email: lowerEmail });

    // 1. Validate OTP and Security Lockout
    if (!agent || agent.failedOtpAttempts >= 5) {
      return res.status(429).json({ success: false, message: "Account locked or not found." });
    }

    if (agent.otp !== otp || (agent.otpExpires && agent.otpExpires < Date.now())) {
      agent.failedOtpAttempts = (agent.failedOtpAttempts || 0) + 1;
      await agent.save();
      return res.status(400).json({ success: false, message: "Invalid or expired code." });
    }

    // 2. Prepare Atomic Update Operations
    const existingDevice = agent.devices.find(d => String(d.deviceId) === String(deviceId));
    let updateQuery = { 
      $set: { isVerified: true, status: 'active', failedOtpAttempts: 0 },
      $unset: { otp: "", otpExpires: "" }
    };

    if (isNewRegistration) {
      if (!identityKey || !preKeys?.length || !signedPreKey) {
        return res.status(400).json({ success: false, message: "Cryptographic bundle required." });
      }
      if (existingDevice) {
        return res.status(403).json({ success: false, message: "Device already registered." });
      }
      // Merge device push into the atomic update
      updateQuery.$push = { 
        devices: { deviceId, registrationId, identityKey, signedPreKey, preKeys, createdAt: new Date(), lastActive: new Date() } 
      };
    } else {
      if (!existingDevice) {
        return res.status(401).json({ success: false, message: "Device not authorized." });
      }
    }

    // 3. Perform SINGLE Atomic Operation
    const updatedAgent = await AgentModel.findOneAndUpdate(
      { _id: agent._id },
      updateQuery,
      { new: true }
    );

    // 4. Issue Token
    const token = jwt.sign(
      { id: updatedAgent._id, slug: updatedAgent.slug, role: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true, secure: true, sameSite: 'Lax', path: '/', 
      maxAge: 7 * 24 * 60 * 60 * 1000, signed: true
    });

    return res.status(200).json({
      success: true,
      slug: updatedAgent.slug,
      message: isNewRegistration ? "Device registered!" : "Login successful!"
    });

  } catch (err) {
    console.error("❌ Verification Error:", err);
    next(err); 
  }
});

router.post('/login', async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
    await connectToDatabase();
    
    const { email, password, targetSlug } = req.body;

    if (!email || typeof email !== 'string' || !password) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const AgentModel = getAgentModel();
    const agent = await AgentModel.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('slug currentSessionId firstName lastName email occupation bio +password isVerified isSubscribed plan'); 
    
    if (!agent || !(await bcrypt.compare(password, agent.password))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    if (!agent.isVerified) {
      return res.status(403).json({ success: false, message: "Please verify your email first" });
    }

    if (agent.slug !== targetSlug) {
      return res.status(403).json({ 
        success: false, 
        message: "Unauthorized: Access denied for this URL." 
      });
    }

    const newSessionId = crypto.randomBytes(16).toString('hex');
    agent.currentSessionId = newSessionId;
    await agent.save();

    // PRIME THE CACHE
    const cacheKey = `agent:profile:${agent._id}`;
    const cacheableAgent = {
      id: agent._id,
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email,
      occupation: agent.occupation,
      bio: agent.bio,
      slug: agent.slug,
      isSubscribed: !!agent.isSubscribed,
      plan: agent.plan || 'BASIC'
    };
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(cacheableAgent));

    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent', sessionId: newSessionId }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' }
    );
res.cookie('token', token, {
  httpOnly: true,
  secure: true,        // Required for HTTPS (must be true in production)
  sameSite: 'Lax',     // Perfect for same-domain communication
  path: '/',           // Ensures the cookie is sent for all routes
  maxAge: 7 * 24 * 60 * 60 * 1000,
  signed: true
});

    // Clean Response: Token is now handled by the browser cookie
    return res.status(200).json({ 
      success: true, 
      slug: agent.slug,
      role: 'agent',
      isSubscribed: !!agent.isSubscribed, 
      plan: agent.plan || 'BASIC'
    });

  } catch (err) {
    next(err);
  }
});

router.get('/profile', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    const AgentModel = getAgentModel();
    if (!AgentModel) throw new Error("Agent Model not initialized");

    // 🛡️ SECURITY FIX: Explicit selection of returned fields
    const agent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { $set: { lastActive: new Date() } }, 
      { new: true } 
    ).select('firstName lastName email occupation bio photoUrl slug plan isSubscribed expiryDate voiceId voicePackageActive lastActive');
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // 2. Auto-lock logic for expired subscriptions
    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      await agent.save();
    }

    // 🛡️ SECURITY FIX: Clean presentation wrapper mapping.
    // This ensures your frontend receives a consistent object structure.
    return res.status(200).json({
      success: true,
      agent: {
        id: agent._id,
        firstName: agent.firstName || "",
        lastName: agent.lastName || "",
        email: agent.email || "",
        occupation: agent.occupation || "",
        bio: agent.bio || "",
        slug: agent.slug || "",
        isSubscribed: !!agent.isSubscribed
      }
    });

  } catch (err) {
    // 🛡️ SECURITY FIX: Pass to error-handling middleware
    next(err);
  }
});
router.get('/profile/me', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const cacheKey = `agent:profile:full:${req.user.id}`;

  try {
    // 1. ATTEMPT CACHE HIT
    const cachedProfile = await redisClient.get(cacheKey);
    if (cachedProfile) {
      return res.status(200).json({ success: true, agent: JSON.parse(cachedProfile) });
    }

    // 2. FALLBACK TO DATABASE (Cache Miss)
    await connectToDatabase();
    const AgentModel = getAgentModel();

    const agent = await AgentModel.findByIdAndUpdate(
      req.user.id,
      { $set: { lastActive: new Date() } },
      { new: true }
    ).select('+currentSessionId +expiryDate +voicePackageExpiry device email firstName lastName occupation program bio address photoUrl slug plan isSubscribed subscriptionAmount subscriptionDate paymentDetails voiceId voicePackageActive publicKeyJwk lastActive createdAt');

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // 3. Security & Business Logic (Keep these live/DB-focused)
    if (req.user.sessionId && agent.currentSessionId && req.user.sessionId !== agent.currentSessionId) {
      return res.status(403).json({ success: false, message: "Dual login detected.", reason: "dual_login" });
    }

    const now = new Date();
    let mutationNeeded = false;
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      mutationNeeded = true;
    }
    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
      agent.voicePackageActive = false;
      mutationNeeded = true;
    }
    if (mutationNeeded) await agent.save();

    // 4. Photo Signing
    let signedPhotoUrl = null;
    if (agent.photoUrl) {
      try {
        signedPhotoUrl = await getPrivateUrl(agent.photoUrl);
      } catch (s3Error) {
        signedPhotoUrl = null;
      }
    }
    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // 5. Build Response Object
    const isOnline = (now - new Date(agent.lastActive)) < 120000;
    const responseData = {
      _id: agent._id,
      email: agent.email || "",
      firstName: agent.firstName || "",
      lastName: agent.lastName || "",
      occupation: agent.occupation || "",
      program: agent.program || "",
      bio: agent.bio || "",
      address: agent.address || "",
      photoUrl: signedPhotoUrl,
      slug: agent.slug || "",
      plan: agent.plan || "BASIC",
      isSubscribed: !!agent.isSubscribed,
      subscriptionAmount: agent.subscriptionAmount || 0,
      subscriptionDate: agent.subscriptionDate || null,
      expiryDate: agent.expiryDate || null,
      voiceId: agent.voiceId || "nPczCjzB2QC9zZ6ULpFM",
      voicePackageActive: !!agent.voicePackageActive,
     devices: agent.devices || [],      // Include the devices array
  isCryptoReady: agent.isCryptoReady,
      status: isOnline ? 'online' : 'offline',
      lastActive: agent.lastActive,
      paymentDetails: {
        amountNgn: agent.paymentDetails?.amountNgn || agent.subscriptionAmount || 0,
        currency: agent.paymentDetails?.currency || "NGN"
      }
    };

    // 6. CACHE RESULT (Set for 1 hour)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(responseData));

    return res.status(200).json({ success: true, agent: responseData });

  } catch (err) {
    next(err);
  }
});
router.post('/heartbeat', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const presenceKey = `agent:online:${req.user.id}`;

  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();

    // 1. Fetch to verify Dual Login (We must perform this check against DB 
    // to ensure the session hasn't been revoked)
    const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    if (req.user.sessionId && agent.currentSessionId && req.user.sessionId !== agent.currentSessionId) {
      return res.status(403).json({ 
        success: false, 
        message: "Session expired due to dual login",
        reason: "dual_login"
      });
    }

    // 2. REDIS PRESENCE: Update status in Redis only.
    // We set a 120-second TTL (Time-To-Live). If the agent stops sending 
    // heartbeats, the key automatically expires, signaling they are offline.
    await redisClient.setEx(presenceKey, 120, 'online');

    // 3. Response: We no longer need to hit MongoDB for the 'lastActive' update.
    // We return the status directly from the memory operation.
    res.json({ 
      success: true, 
      lastActive: new Date(), 
      status: 'online' 
    });

  } catch (err) {
    next(err);
  }
});

router.post('/verify', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
    await connectToDatabase();
    const { transaction_id, plan } = req.body;
    
    if (!transaction_id || !plan) {
      return res.status(400).json({ success: false, message: "Transaction ID and target plan are required." });
    }

    const AgentModel = getAgentModel();
    const agent = await AgentModel.findById(req.user.id);

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent profile not found." });
    }

    // 1. DUAL PROTECTION: Transaction Idempotency Check
    // Prevents the same transaction from being used twice to stack time
    if (agent.lastTransactionId === String(transaction_id)) {
      return res.status(400).json({ success: false, message: "Transaction already processed." });
    }

    // 2. Verify with Flutterwave
    const response = await flw.Transaction.verify({ id: transaction_id });
    const data = response.data;

    const planPricesInNGN = { 'BASIC': 8500, 'GROWTH': 51000, 'PROFESSIONAL': 102000 };
    const targetPlan = String(plan).toUpperCase().trim();
    
    if (!planPricesInNGN[targetPlan] || Number(data.amount) < planPricesInNGN[targetPlan] || data.status !== "successful") {
      return res.status(400).json({ success: false, message: "Invalid payment or plan mismatch." });
    }

    // 3. Subscription Stacking Logic
    const now = new Date();
    let baseDate = (agent.isSubscribed && agent.expiryDate && new Date(agent.expiryDate) > now) 
      ? new Date(agent.expiryDate) 
      : now;

    const monthsMap = { 'BASIC': 1, 'GROWTH': 6, 'PROFESSIONAL': 12 };
    baseDate.setMonth(baseDate.getMonth() + monthsMap[targetPlan]);

    // 4. ATOMIC UPDATE (using findOneAndUpdate)
    const updatedAgent = await AgentModel.findOneAndUpdate(
      { _id: req.user.id },
      {
        $set: {
          isSubscribed: true,
          plan: targetPlan,
          status: 'active',
          subscriptionDate: agent.subscriptionDate || now,
          expiryDate: baseDate,
          expiryNotificationSent: false,
          lastTransactionId: String(transaction_id),
          subscriptionAmount: Number(data.amount),
          paymentDetails: {
            amountNgn: Number(data.amount),
            currency: "NGN",
            verifiedAt: now
          }
        }
      },
      { new: true, runValidators: false }
    );

    // 5. Background Task & Cache Invalidation
    syncBilling(updatedAgent, Number(data.amount));
    await redisClient.del(`agent:profile:${req.user.id}`);
    await redisClient.del(`agent:profile:full:${req.user.id}`);

    return res.status(200).json({
      success: true,
      message: "Subscription activated successfully.",
      redirectUrl: `/agent/dashboard/${updatedAgent.slug}`,
      agent: updatedAgent
    });

  } catch (err) {
    next(err);
  }
});

router.put('/update-profile', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();

    // 1. Fetch with required sensitive fields
    const agent = await AgentModel.findById(req.user.id).select('+password +unlockedVoiceIds');
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found" });
    }

    const { 
      firstName, lastName, occupation, program, bio, address, 
      gender, dob, voiceId, voiceDisplayName, voiceSettings,
      oldPassword, newPassword 
    } = req.body;

    // 2. Handle Password Updates
    if (newPassword && String(newPassword).trim() !== "") {
      if (!oldPassword) {
        return res.status(400).json({ success: false, message: "Current password is required." });
      }
      const isMatch = await bcrypt.compare(oldPassword, agent.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Current password incorrect." });
      }
      const salt = await bcrypt.genSalt(10);
      agent.password = await bcrypt.hash(String(newPassword), salt);
    }

    // 3. Strict Explicit Mutate Assignment
    if (firstName !== undefined) agent.firstName = String(firstName).trim();
    if (lastName !== undefined) agent.lastName = String(lastName).trim();
    if (occupation !== undefined) agent.occupation = String(occupation).trim();
    if (program !== undefined) agent.program = String(program).trim();
    if (bio !== undefined) agent.bio = String(bio).trim();
    if (address !== undefined) agent.address = String(address).trim();
    if (gender !== undefined) agent.gender = String(gender).toLowerCase().trim();
    if (dob !== undefined) agent.dob = dob;

    // 4. Voice Licensing Access Control
    if (voiceId !== undefined) {
      if (voiceId === null) {
        agent.voiceId = null;
      } else {
        const hasLicense = agent.unlockedVoiceIds && agent.unlockedVoiceIds.includes(String(voiceId));
        if (hasLicense) {
          agent.voiceId = String(voiceId);
        } else {
          return res.status(403).json({ success: false, message: "Unauthorized license." });
        }
      }
    }

    if (voiceDisplayName !== undefined) agent.voiceDisplayName = String(voiceDisplayName).trim();
    if (voiceSettings && typeof voiceSettings === 'object') {
      agent.voiceSettings = { ...agent.voiceSettings, ...voiceSettings };
    }

    await agent.save();

    // 5. 🚀 CACHE INVALIDATION
    // Purge both private dashboard cache and public profile cache
    await redisClient.del(`agent:profile:full:${req.user.id}`);
    await redisClient.del(`agent:public:${agent.slug}`);

    // 6. Strict Response Whitelisting DTO
    return res.status(200).json({
      success: true,
      message: "Identity, Voice, and Security synchronized successfully.",
      agent: {
        id: agent._id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        occupation: agent.occupation,
        program: agent.program,
        bio: agent.bio,
        address: agent.address,
        gender: agent.gender,
        dob: agent.dob,
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed,
        voiceId: agent.voiceId,
        voiceDisplayName: agent.voiceDisplayName,
        voiceSettings: agent.voiceSettings || {}
      }
    });

  } catch (err) {
    next(err);
  }
});

router.put('/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  
  try {
    await connectToDatabase();
    
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User identity not found in token" });
    }

    const { firstName, lastName, dob, gender, city, state, phone } = req.body;

    // 1. Safe-Guard Phone Object
    let parsedPhone = { raw: "", formatted: "", countryCode: "", dialCode: "" };
    if (phone) {
      try {
        const parsed = typeof phone === 'string' ? JSON.parse(phone) : phone;
        parsedPhone = {
          raw: parsed.raw ? String(parsed.raw).trim() : "",
          formatted: parsed.formatted ? String(parsed.formatted).trim() : "",
          countryCode: parsed.countryCode ? String(parsed.countryCode).toLowerCase().trim() : "",
          dialCode: parsed.dialCode ? String(parsed.dialCode).trim() : ""
        };
      } catch (e) {
        parsedPhone.raw = String(phone).trim();
      }
    }

    const updateData = {
      firstName: firstName ? String(firstName).trim() : "",
      lastName: lastName ? String(lastName).trim() : "",
      phone: parsedPhone,
      dob: dob || null, 
      gender: gender && typeof gender === 'string' ? gender.toLowerCase().trim() : undefined,
      city: city ? String(city).trim() : "",
      state: state ? String(state).trim() : "",
      isProfileComplete: true,
      isVerified: true
    };

    // 2. Hardened File Handling
    if (req.file) {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const allowedExtensions = /.(jpg|jpeg|png|webp)$/i;

      if (!allowedMimeTypes.includes(req.file.mimetype) || !allowedExtensions.test(req.file.originalname)) {
        return res.status(400).json({ success: false, message: "Security Violation: Unsupported file type." });
      }

      const s3Client = getS3Client();
      const cryptoKey = crypto.randomBytes(16).toString('hex');
      const fileExtension = req.file.originalname.split('.').pop();
      const fileKey = `users/${userId}-${cryptoKey}.${fileExtension}`;
      
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      updateData.photoUrl = fileKey;
    }

    // 3. Atomic Update (Removed publicKeyJwk, added devices)
    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('firstName lastName isProfileComplete photoUrl dob gender city state phone devices'); 

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User account not found" });
    }

    // 4. CACHE INVALIDATION
    if (redisClient?.isOpen) {
      try {
        const keys = await redisClient.keys(`user:session:${userId}:*`);
        if (keys.length > 0) await redisClient.del(keys);
      } catch (cacheErr) {
        console.error("Cache invalidation failed:", cacheErr.message);
      }
    }

    // 5. Whitelisted Response with Virtuals
    const userJson = updatedUser.toJSON();
    return res.json({ 
      success: true, 
      message: "Onboarding complete", 
      user: {
        ...userJson,
        isCryptoReady: userJson.isCryptoReady // Frontend uses this to trigger signal handshake
      }
    });

  } catch (err) {
    next(err);
  }
});

router.get('/my-users', authenticateToken, async (req, res, next) => {
 const agentId = req.user?.id || req.user?._id;
  if (!agentId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  // Safely attempt to get the client
  const redisClient = req.app.get('redisClient');
  const cacheKey = `agent:users:list:${agentId}`;

  try {
    // 1. ATTEMPT CACHE HIT (Only if client is active and open)
    if (redisClient?.isOpen) {
      try {
        const cachedData = await getCachedData(cacheKey);
        if (cachedData) return res.status(200).json(JSON.parse(cachedData));
      } catch (cacheErr) {
        console.error("Cache read error, proceeding to DB:", cacheErr.message);
      }
    }

    // 2. FALLBACK TO DATABASE (Cache Miss)
    await connectToDatabase();
    const ActiveUserModel = mongoose.models.User || User;

    const users = await ActiveUserModel.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl gender city state isVerified isProfileComplete lastLogin lastActive createdAt publicKeyJwk')
      .sort({ lastActive: -1 })
      .lean();

    const unreadCountsData = await Message.aggregate([
      { 
        $match: { 
          receiverId: new mongoose.Types.ObjectId(String(agentId)),
          receiverModel: 'Agent', 
          status: { $in: ['sent', 'delivered'] }
        } 
      },
      { $group: { _id: "$senderId", count: { $sum: 1 } } }
    ]);

    const unreadMap = unreadCountsData.reduce((acc, item) => {
      if (item._id) acc[item._id.toString()] = item.count;
      return acc;
    }, {});

    const nowTimestamp = Date.now();

    // 3. Process and map DTOs
    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      if (user.photoUrl && typeof user.photoUrl === 'string') {
        try {
          finalPhotoUrl = await getPrivateUrl(user.photoUrl);
        } catch (s3Err) {
          console.error(`[S3 Error] Failed to sign photo for ${user._id}:`, s3Err.message);
        }
      }

      if (!finalPhotoUrl) {
        const name = encodeURIComponent(`${user.firstName || 'U'} ${user.lastName || ''}`);
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
      }

      const lastSeen = user.lastActive || user.lastLogin;
      const isOnline = lastSeen && (nowTimestamp - new Date(lastSeen).getTime()) < (5 * 60 * 1000);
      const userStringId = user._id.toString();

      return {
        id: userStringId,
        _id: userStringId,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: user.phone || {},
        photoUrl: finalPhotoUrl,
        avatar: finalPhotoUrl,
        avatarUrl: finalPhotoUrl,
        status: isOnline ? 'online' : 'offline',
        gender: user.gender || "Not Specified",
        city: user.city || "",
        state: user.state || "",
        isVerified: !!user.isVerified,
        isProfileComplete: !!user.isProfileComplete,
        unreadCount: unreadMap[userStringId] || 0,
        lastActive: user.lastActive || null,
        createdAt: user.createdAt,
        modelType: 'User',
        publicKeyJwk: user.publicKeyJwk || null
      };
    }));

    const responsePayload = {
      success: true,
      count: processedUsers.length,
      users: processedUsers
    };

    if (redisClient?.isOpen) {
      try {
        await redisClient.setEx(cacheKey, 300, JSON.stringify(responsePayload));
      } catch (cacheErr) {
        console.error("Cache write error, skipping:", cacheErr.message);
      }
    }

    return res.json(responsePayload);

  } catch (err) {
    next(err);
  }
});

router.get('/my-session', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const userId = req.user?.id || req.user?._id;
  const { agentId, slug } = req.query;
  
  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized: No secure user context." });
  }

  // Unique cache key per user and context
  const cacheKey = `user:session:${userId}:${agentId || slug || 'default'}`;

  try {
    // 1. ATTEMPT CACHE HIT
    const cachedSession = await redisClient.get(cacheKey);
    if (cachedSession) {
      return res.status(200).json(JSON.parse(cachedSession));
    }

    // 2. FALLBACK TO DATABASE (Cache Miss)
    await connectToDatabase();
    const user = await User.findById(userId)
      .select('email isProfileComplete lastActive connectedAgents publicKeyJwk')
      .populate('connectedAgents', 'firstName lastName photoUrl occupation program bio slug lastActive gender dob publicKeyJwk');

    if (!user) return res.status(404).json({ success: false, message: "User account not found" });

    // Update activity
    User.updateOne({ _id: userId }, { $set: { lastActive: new Date() } }).catch(console.error);

    let activeAgent = null;
    if (slug || agentId) {
       activeAgent = user.connectedAgents.find(a => a.slug === slug || a._id.toString() === agentId);
       if (!activeAgent) {
          const freshAgent = await Agent.findOne(slug ? { slug } : { _id: agentId });
          if (freshAgent) {
            await User.updateOne({ _id: userId }, { $addToSet: { connectedAgents: freshAgent._id } });
            activeAgent = freshAgent;
          }
       }
    } else {
       activeAgent = user.connectedAgents[user.connectedAgents.length - 1] || null;
    }

    // 3. Status and Signing
    let isOnline = false, signedPhotoUrl = null;

    if (activeAgent) {
      // REDIS PRESENCE CHECK: Check if the heartbeat exists
      const onlineStatus = await redisClient.get(`agent:online:${activeAgent._id}`);
      isOnline = !!onlineStatus;

      try {
        signedPhotoUrl = activeAgent.photoUrl ? await getPrivateUrl(activeAgent.photoUrl) : 
          `https://ui-avatars.com/api/?name=${encodeURIComponent(activeAgent.firstName)}+${encodeURIComponent(activeAgent.lastName)}&background=0D1117&color=fff&size=128`;
      } catch (s3Err) {
        console.error("S3 Session Signing Error:", s3Err.message);
      }
    }

    // 4. Return Whitelisted Response
    const responsePayload = {
      success: true,
      user: { 
        id: user._id, 
        email: user.email, 
        isProfileComplete: user.isProfileComplete,
        publicKeyJwk: user.publicKeyJwk 
      },
      agent: activeAgent ? { 
        ...(activeAgent.toObject ? activeAgent.toObject() : activeAgent), 
        photoUrl: signedPhotoUrl, 
        status: isOnline ? 'online' : 'offline', 
        lastSeenText: isOnline ? "Online" : "Offline",
        publicKeyJwk: activeAgent.publicKeyJwk 
      } : null
    };

    // 5. SET CACHE (Set for 1 hour)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(responsePayload));

    return res.status(200).json(responsePayload);

  } catch (err) {
    next(err);
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

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    
    if (!userId || !role) {
      return res.status(400).json({ success: false, message: "Invalid session data" });
    }
    
    let profile = null;
    
    if (role === 'agent') {
      const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
      profile = await AgentModel.findById(userId)
        .select('firstName lastName email slug role isSubscribed plan publicKeyJwk')
        .lean();
    } else {
      const UserModel = mongoose.models.User || mongoose.model('User');
      profile = await UserModel.findById(userId)
        .select('email role isProfileComplete publicKeyJwk')
        .lean();
    }

    if (!profile) {
      return res.status(404).json({ success: false, message: "User/Agent not found" });
    }

    return res.json({ 
      success: true, 
      role: role,
      profile: profile 
    });
  } catch (err) {
    console.error("Session verification error:", err);
    return res.status(500).json({ success: false, message: "Server error during session verification" });
  }
});

router.get('/crypto/bundle/:userId', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const modelName = req.query.model === 'Agent' ? 'Agent' : 'User';
    const TargetModel = mongoose.model(modelName);

    const updatedUser = await TargetModel.findOneAndUpdate(
      { _id: userId, isCryptoReady: true, "publicKeyJwk.preKeys.0": { $exists: true } },
      { $pop: { "publicKeyJwk.preKeys": -1 } },
      { returnDocument: 'before' }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "No keys available." });
    }

    const { publicKeyJwk } = updatedUser;
    return res.status(200).json({ 
      success: true, 
      registrationId: publicKeyJwk.registrationId,
      identityKey: publicKeyJwk.identityKey,
      signedPreKey: publicKeyJwk.signedPreKey,
      preKey: publicKeyJwk.preKeys[0] 
    });
  } catch (err) {
    next(err);
  }
});

export default router;