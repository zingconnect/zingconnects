import dotenv from 'dotenv';
dotenv.config(); 

console.log("--- ATTEMPTING TO START SERVER ---");

// 2. Standard Third-Party and Vendor Package Imports
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'path'; 
import fs from 'fs';   
import jwt from 'jsonwebtoken'; 
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import WebSocket from 'ws';
import nodemailer from 'nodemailer';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { Server } from 'socket.io';
import http from 'http';
import { createClient } from 'redis'; // 👈 Added Redis Import

// --- REDIS CACHING CLIENT INITIALIZATION ---
const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error('🔴 Redis Cache Client Error:', err));
redisClient.on('connect', () => console.log('⚡ Connected to Redis Cache Cloud successfully!'));

// Establish the connection instantly on execution context startup
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('⚠️ Could not initialize Redis connection:', err.message);
  }
})();
// ------------------------------------------

// 3. Database & Shared Configurations
import { connectToDatabase } from './config/db.js';
import { getS3Client, getPrivateUrl, uploadToS3, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from './config/s3.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 4. Local Utility Framework Helpers (Now fully hydrated with process.env keys)
import { createLiveKitToken } from './utils/livekitHelper.js';
import { sendOfflineNotification } from './utils/mailer.js';

// 5. Schema Data Models
import Agent from './models/Agent.js';
import User from './models/User.js'; 
import Message from './models/Message.js';
import Admin from './models/Admin.js';
import Call from './models/Call.js'; 
import SupportMessage from './models/Support.js';

// 6. Express Routing Modules
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/message.js'; 
import callRoutes from './routes/callRoutes.js';
import adminRoutes from './routes/admin.js'; 

const app = express();
app.disable('x-powered-by');

const terminatingCallsCache = new Set();
app.set('terminatingCallsCache', terminatingCallsCache);

// Expose redis cache global registry context into routing modules 
app.set('redisClient', redisClient); 

const corsOptions = {
  origin: "https://zingconnect.vercel.app",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  path: '/api/socket.io',
  cors: corsOptions,
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

app.set('socketio', io);
app.use('/api/calls', callRoutes);
app.use('/api/messages', messageRoutes); 
app.use('/api/agents', authRoutes);
app.use('/api/admin', adminRoutes);

const flw = new Flutterwave(process.env.VITE_FLW_PUBLIC_KEY, process.env.VITE_FLW_SECRET_KEY);
webpush.setVapidDetails(
  `mailto:${process.env.VITE_EMAIL}`,
  process.env.VITE_PUBLIC_KEY, 
  process.env.VITE_PRIVATE_KEY
);

const upload = multer({ storage: multer.memoryStorage() });
const getAgentModel = () => {
  return mongoose.models.Agent || Agent;
};
const authenticateToken = async (req, res, next) => {
  // 1. Extract token safely
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) return res.status(401).json({ success: false, message: "Access Denied: No token provided" });

  try {
    // 2. Verify token synchronously
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.id = decoded.id || decoded._id;

    // 3. Logic for Agents
    if (decoded.role === 'agent') {
      const AgentModel = mongoose.models.Agent || Agent;
      const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
      
      if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

      // Dual Login check
      if (agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
        return res.status(403).json({ 
          success: false, 
          message: "Dual login detected.", 
          reason: "dual_login" 
        });
      }
      
      await AgentModel.findByIdAndUpdate(req.user.id, { $set: { lastActive: new Date() } });
    }

    // 4. Logic for Admin
    if (decoded.role === 'admin') {
      const AdminModel = mongoose.models.Admin || Admin;
      await AdminModel.findByIdAndUpdate(req.user.id, { $set: { lastLogin: new Date() } });
    }

    next();
  } catch (err) {
    // Distinguish between expired and invalid tokens
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(403).json({ success: false, message: "Invalid Token" });
  }
};

const isAdmin = (req, res, next) => {
  // Allows BOTH admin and superadmin to pass through
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
const requireSuperAdmin = (req, res, next) => {
  // STRICT CHECK: Denies regular admins completely
  if (req.user && req.user.role === 'superadmin') {
    return next();
  }

  return res.status(403).json({ 
    success: false, 
    message: "Access Denied: Superadmin authorization required for this operation." 
  });
};

io.on("connection", (socket) => {
  console.log("Socket Connected:", socket.id);
  socket.on("join-main-room", async (userId) => {
    if (userId) {
      socket.userId = userId; 
      socket.join(userId.toString());
      
      try {
        await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
        io.emit("user_status_update", { 
          userId, 
          isOnline: true, 
          lastSeen: new Date() 
        });
        console.log(`User ${userId} is online.`);
      } catch (err) {
        console.error("❌ Join Room DB Sync Failed:", err.message);
      }
    }
  });
  
  socket.on("call-user", async ({ userToCall, fromId, fromName, photoUrl, roomName, voiceId }) => {
    if (!userToCall || !roomName) return;
    try {
      let signedUrl = photoUrl;
      if (photoUrl && !photoUrl.startsWith('http')) {
        signedUrl = await getPrivateUrl(photoUrl);
      }
      io.to(userToCall.toString()).emit("incoming-call", { 
        fromId, 
        fromName, 
        photoUrl: signedUrl, 
        roomName: roomName.trim(),
        voiceId: voiceId || null
      });
      User.findById(userToCall).select('pushSubscription').lean().then(user => {
        if (user?.pushSubscription) {
          const payload = JSON.stringify({
            title: "Incoming Secure Call",
            body: `${fromName} is calling you...`,
            data: { url: `/dashboard/call/${roomName}` }
          });
          webpush.sendNotification(user.pushSubscription, payload)
            .catch(e => console.error("Push failed:", e));
        }
      });

    } catch (err) {
      console.error("❌ Socket Call Signal Failed:", err.message);
    }
  });

  socket.on("answer-call", ({ to, callId, roomName }) => {
    if (!to || !roomName) return;
    const cleanRoom = String(roomName).trim();
    console.log(`📡 Handshake Accepted: Relaying call-accepted to Caller room ${to}`);
    io.to(to.toString()).emit("call-accepted", { 
      callId,
      roomName: cleanRoom 
    });
  });

  socket.on("end-call", ({ to, callId }) => {
    if (to) {
      const targetRoom = to.toString().trim();
      console.log(`📴 Relaying call-ended termination sequence to: ${targetRoom}`);
      io.to(targetRoom).emit("call-ended", { callId });
      io.to(targetRoom).emit("end-call", { callId }); 
    }
  });

  socket.on("reject-call", ({ to, callId }) => {
    if (to) {
      const targetRoom = to.toString().trim();
      console.log(`❌ Relaying call-rejected state directly to: ${targetRoom}`);
      io.to(targetRoom).emit("call-rejected", { callId });
      io.to(targetRoom).emit("call-ended", { callId }); 
    }
  });

  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.id);
    if (socket.userId) {
      try {
        const lastSeen = new Date();
        await User.findByIdAndUpdate(socket.userId, { 
          isOnline: false, 
          lastSeen 
        });
        io.emit("user_status_update", { 
          userId: socket.userId, 
          isOnline: false, 
          lastSeen 
        });
      } catch (err) {
        console.error("❌ Offline State Sync Failed:", err.message);
      }
    }
  });

  socket.on("join-support-as-guest", (guestId) => {
    if (guestId) {
      socket.guestId = guestId;
      socket.join(guestId); 
      console.log(`Guest ${guestId} joined support.`);
      io.emit("admin_new_guest_online", { guestId, timestamp: new Date() });
    }
  });

  socket.on("guest_to_admin_message", async (payload) => {
    try {
      const { guestId, text } = payload;
      await connectToDatabase(); 

      if (!guestId || !text) {
        return console.error("Database Save Denied: Missing guestId or text content.");
      }
      const savedMsg = await SupportMessage.create({
        guestId: String(guestId),
        text: text,
        senderType: 'Guest',
        isAdminRead: false
      });
      console.log("Database Success: Message stored under ID:", savedMsg._id);
      io.emit("admin_receive_support_message", {
        _id: savedMsg._id,
        guestId: savedMsg.guestId,
        text: savedMsg.text,
        isAdmin: false,
        timestamp: savedMsg.createdAt
      });
    } catch (err) {
      console.error("Critical Database Error:", err.message);
    }
  });

  socket.on("admin_to_guest_message", async (payload) => {
    console.log("📥 Admin Payload Received:", payload);
    
    try {
      await connectToDatabase(); 
      const { guestId, text, senderType } = payload;

      if (!guestId || !text) {
        console.error("❌ Save Blocked: Missing guestId or text");
        return;
      }
      const savedMsg = await SupportMessage.create({
        guestId: String(guestId),
        text: text,
        senderType: senderType || 'Admin', 
        isAdminRead: true
      });

      console.log("✅ Database Save Successful:", savedMsg._id);
      socket.join(String(guestId));
      io.to(String(guestId)).emit("guest_receive_admin_message", {
        _id: savedMsg._id,
        text: savedMsg.text,
        isAdmin: true,
        timestamp: savedMsg.createdAt
      });
      socket.emit("admin_message_stored", savedMsg);

    } catch (err) {
      console.error("❌ Mongoose Error Details:", err);
    }
  });
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/agents/register-init
// =========================================================================
app.post('/api/agents/register-init', upload.single('photo'), async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();

    const { firstName, lastName, email, password } = req.body;
    const isResend = req.body.resend === 'true' || req.body.resend === true;

    // 1. INPUT VALIDATION
    if (!email) return res.status(400).json({ success: false, message: "Email required." });
    
    const lowerEmail = String(email).toLowerCase().trim();
    let existingAgent = await AgentModel.findOne({ email: lowerEmail });

    // 🛡️ SECURITY FIX: OTP Throttling (Prevents Email Bombing)
    if (existingAgent?.otpExpires && existingAgent.otpExpires > Date.now()) {
      return res.status(429).json({ success: false, message: "Verification code already sent. Please wait." });
    }

    if (existingAgent?.isVerified) {
      return res.status(400).json({ success: false, message: "Account already verified." });
    }

    // 🛡️ SECURITY FIX: File size & Sanitization
    let savedPhotoPath = existingAgent?.photoUrl || "";
    if (req.file) {
      if (req.file.size > 2 * 1024 * 1024) return res.status(400).json({ success: false, message: "Photo too large." });
      
      const fileKey = `profiles/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-')}`;
      await getS3Client().send(new PutObjectCommand({
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      savedPhotoPath = `https://${process.env.IDRIVE_BUCKET_NAME}.${process.env.IDRIVE_ENDPOINT?.replace('https://', '')}/${fileKey}`;
    }

    // 2. DATA PERSISTENCE
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + (10 * 60 * 1000);

    if (existingAgent) {
      if (password) existingAgent.password = await bcrypt.hash(password, 10);
      Object.assign(existingAgent, { otp: otpCode, otpExpires: otpExpiry, photoUrl: savedPhotoPath });
      await existingAgent.save();
    } else {
      await AgentModel.create({
        firstName: (firstName || "Agent").trim(),
        lastName: (lastName || "").trim(),
        email: lowerEmail,
        password: await bcrypt.hash(password || "temp123", 10),
        slug: `${(firstName || "agent").toLowerCase()}-${Date.now().toString().slice(-4)}`,
        photoUrl: savedPhotoPath,
        otp: otpCode,
        otpExpires: otpExpiry
      });
    }

    // 3. EMAIL DELIVERY
    await sendVerificationEmail(lowerEmail, firstName || "Agent", otpCode);
    return res.status(200).json({ success: true, message: "Verification code sent." });

  } catch (err) {
    next(err); // Safely log error
  }
});

// Email Template Helper
async function sendVerificationEmail(email, firstName, otpCode) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });

  await transporter.sendMail({
    from: `"ZingConnect Security" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Your Verification Code",
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
}

// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/agents/verify-otp
// =========================================================================
app.post('/api/agents/verify-otp', async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const lowerEmail = email.toLowerCase().trim();
    const agent = await AgentModel.findOne({ email: lowerEmail });

    // 🛡️ SECURITY FIX 1: Brute-Force & Validation Check
    // We check if the agent exists first to keep the logic clean and prevent timing attacks
    if (!agent || agent.otp !== otp || (agent.otpExpires && agent.otpExpires < Date.now())) {
      // 🛡️ SECURITY FIX 2: Generic Error Message
      // Never tell the attacker WHY it failed (expired vs. wrong code) to prevent enumeration
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired verification code." 
      });
    }

    // Update agent status
    agent.isVerified = true;
    agent.status = 'active';
    agent.otp = undefined;
    agent.otpExpires = undefined;
    await agent.save();
    if (!process.env.JWT_SECRET) {
      throw new Error("Security configuration error.");
    }

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
    // 🛡️ SECURITY FIX 4: Prevent leaking internal DB details
    next(err); 
  }
});
app.post('/api/agents/login', async (req, res, next) => {
  try {
    await connectToDatabase();
    const { email, password, targetSlug } = req.body;

    if (!email || typeof email !== 'string' || !password) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const AgentModel = getAgentModel();
    const agent = await AgentModel.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('slug currentSessionId +password'); 
    
    if (!agent) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
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
    res.cookie('token', token, {
      httpOnly: true,                // Prevents client-side JS access
      secure: process.env.NODE_ENV === 'production', // Ensures HTTPS in production
      sameSite: 'strict',            // Protects against CSRF
      maxAge: 24 * 60 * 60 * 1000    // 24 hours
    });

    return res.json({ 
      success: true, 
      slug: agent.slug 
    });

  } catch (err) {
    next(err);
  }
});

// ==========================================
// 🛡️ HARDENED ROUTE 1: GET /api/agents/profile
// ==========================================
app.get('/api/agents/profile', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel(); 
    
    // 🛡️ SECURITY FIX: Combined into a single database touch and limited return fields
    const agent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { $set: { lastActive: new Date() } },
      { new: true } 
    ).select('firstName lastName email occupation bio photoUrl slug plan isSubscribed expiryDate voiceId voicePackageActive lastActive');

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // Logic for expiry check
    if (agent.isSubscribed && agent.expiryDate && new Date() > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      await agent.save();
    }

    // 🛡️ SECURITY FIX: Clean presentation wrapper mapping. Never pass raw database models.
    return res.json({
      success: true,
      agent: {
        id: agent._id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        email: agent.email,
        occupation: agent.occupation,
        bio: agent.bio,
        slug: agent.slug,
        isSubscribed: !!agent.isSubscribed
      }
    });

  } catch (err) {
    // 🛡️ SECURITY FIX: Pipe safely out via next channel
    next(err);
  }
});

// ==========================================
// 🛡️ HARDENED ROUTE 2: GET /api/agents/profile/me
// ==========================================
app.get('/api/agents/profile/me', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Invalid session" });
    }

    const AgentModel = getAgentModel();
    
    // 🛡️ SECURITY FIX: Ensure sensitive properties don't populate application layer memory spaces
    const agent = await AgentModel.findById(req.user.id)
      .select('+currentSessionId +expiryDate +voicePackageExpiry email firstName lastName occupation photoUrl slug plan isSubscribed subscriptionDate voiceId voicePackageActive lastActive createdAt');

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // 1. Dual Login Security Check
    if (req.user.sessionId && agent.currentSessionId && req.user.sessionId !== agent.currentSessionId) {
      return res.status(403).json({ 
        success: false, 
        message: "Dual login detected.",
        reason: "dual_login" 
      });
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
    
    if (mutationNeeded) {
      await agent.save();
    }

    const lastActiveDate = agent.lastActive || agent.createdAt;
    const isOnline = (now - new Date(lastActiveDate)) < 120000;
    let signedPhotoUrl = null;

    if (agent.photoUrl) {
      try {
        if (agent.photoUrl.startsWith('http')) {
          const urlParts = agent.photoUrl.split('.com/');
          const rawKey = urlParts[1] || agent.photoUrl.split('/').slice(3).join('/');
          signedPhotoUrl = await getPrivateUrl(rawKey);
        } else {
          signedPhotoUrl = await getPrivateUrl(agent.photoUrl);
        }
      } catch (s3Error) {
        console.error("Non-blocking S3 URL signing failure:", s3Error.message);
        signedPhotoUrl = null; 
      }
    }

    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // Return Normalized Client Presentation Payload
    return res.status(200).json({
      success: true,
      agent: {
        _id: agent._id,
        email: agent.email || "",
        firstName: agent.firstName || "",
        lastName: agent.lastName || "",
        occupation: agent.occupation || "",
        photoUrl: signedPhotoUrl, 
        slug: agent.slug || "",
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed, 
        subscriptionDate: agent.subscriptionDate || null,
        expiryDate: agent.expiryDate || null,
        voiceId: agent.voiceId || "nPczCjzB2QC9zZ6ULpFM",
        voicePackageActive: !!agent.voicePackageActive, 
        status: isOnline ? 'online' : 'offline',
        lastActive: agent.lastActive
      }
    });

  } catch (err) {
    // 🛡️ SECURITY FIX: Drop to the global error interceptor rather than printing err.message
    next(err);
  }
});
// 🛡️ SECURITY FIX 1: Add 'next' parameter for global error handling
app.post('/api/agents/update-plan', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { plan } = req.body; 
    const allowedPlans = ['BASIC', 'PREMIUM', 'ENTERPRISE']; 
        const sanitizedPlan = plan ? String(plan).toUpperCase().trim() : null;

    if (!sanitizedPlan || !allowedPlans.includes(sanitizedPlan)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid plan type selection parameter." 
      });
    }
    const AgentModel = getAgentModel(); 
        const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id,
      { $set: { plan: sanitizedPlan } }, // Using explicit $set operator
      { new: true, select: 'plan' }     // 🌟 Only fetch back the 'plan' key, nothing else!
    );

    if (!updatedAgent) {
      return res.status(404).json({ success: false, message: "Agent account context mismatch." });
    }

    return res.json({ 
      success: true, 
      plan: updatedAgent.plan 
    });

  } catch (err) {
    next(err);
  }
});

app.post('/api/users/handshake', async (req, res, next) => {
  try {
    await connectToDatabase();
    
    // 1. We only need email and agentSlug from the request body
    const { email, agentSlug } = req.body;
    
    if (!email) return res.status(400).json({ success: false, message: "Email required" });
    if (!agentSlug) return res.status(400).json({ success: false, message: "Agent context is required" });

    // 2. Dynamically find the Agent to get the correct agentId
    const agent = await Agent.findOne({ slug: agentSlug.toLowerCase().trim() });
    
    if (!agent) {
      return res.status(400).json({ success: false, message: "Agent not found" });
    }
    
    const agentId = agent._id;

    // 3. Proceed with User logic
    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail }).select('email connectedAgents isProfileComplete');
    let isNewUser = false;

    if (!user) {
      user = new User({
        email: normalizedEmail,
        connectedAgents: [agentId],
        lastLogin: new Date(),
        isProfileComplete: false
      });
      await user.save();
      isNewUser = true;
    } else {
      const stringifiedId = agentId.toString();
      const hasAgent = user.connectedAgents.some(id => id.toString() === stringifiedId);
      
      if (!hasAgent) {
        user.connectedAgents.push(agentId);
      }
      user.lastLogin = new Date();
      await user.save();
    }

    const token = jwt.sign(
      { 
        id: user._id, 
        role: 'user',
        activeAgentSlug: agent.slug // Use the slug from the DB for consistency
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({ 
      success: true, 
      isNewUser, 
      isProfileComplete: user.isProfileComplete 
    });
    
  } catch (err) {
    next(err);
  }
});

// 🛡️ SECURITY FIX 1: Ensure 'next' is included in your routing arguments
app.post('/api/agents/heartbeat', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();

    const agent = await AgentModel.findById(req.user.id).select('currentSessionId');

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // --- DUAL LOGIN SECURITY CHECK ---
    if (req.user.sessionId && agent.currentSessionId && req.user.sessionId !== agent.currentSessionId) {
      return res.status(403).json({ 
        success: false, 
        message: "Session expired due to dual login",
        reason: "dual_login"
      });
    }

    // 🛡️ SECURITY FIX 2: Explicitly query and return only the targeted parameter
    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { $set: { lastActive: new Date() } }, 
      { new: true, select: 'lastActive' } 
    );

    // 🛡️ SECURITY FIX 3: Add a safety fallback guard to avoid Null Pointer crashes
    if (!updatedAgent) {
      return res.status(404).json({ success: false, message: "Agent status mapping failed." });
    }

    res.json({ 
      success: true, 
      lastActive: updatedAgent.lastActive,
      status: 'online' 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 4: Send the breakdown smoothly to the bottom global safety filter
    next(err);
  }
});

// 🛠️ FIX 1: Add 'next' to your route arguments so the centralized error interceptor can catch issues
app.get('/api/users/my-session', async (req, res, next) => {
  try {
    await connectToDatabase();
    
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token" });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 🔍 Capture target agent criteria from query parameters
    const { agentId, slug } = req.query;

    // 🛡️ SECURITY FIX 2: Harden user retrieval by only passing selected public properties
    const user = await User.findByIdAndUpdate(
      decoded.id, 
      { lastActive: new Date() },
      { returnDocument: 'after' } 
    ).select('email isProfileComplete lastActive connectedAgents') // 🌟 Force explicit safe database selection
    .populate({
      path: 'connectedAgents',
      select: 'firstName lastName photoUrl occupation program bio slug lastActive gender dob'
    });

    if (!user) return res.status(404).json({ message: "User not found" });
    let activeAgent = null;

    if (user.connectedAgents && user.connectedAgents.length > 0) {
      if (agentId) {
        activeAgent = user.connectedAgents.find(a => a._id.toString() === agentId.toString()) || null;
      } else if (slug) {
        activeAgent = user.connectedAgents.find(a => a.slug === slug) || null;
      }
    }
    
    if (!activeAgent && (slug || agentId)) {
      const query = slug ? { slug: slug } : { _id: agentId };
      
      // 🛡️ SECURITY FIX 3: Force limit selected data fields for fresh agent lookups
      const freshAgent = await Agent.findOne(query).select(
        'firstName lastName photoUrl occupation program bio slug lastActive gender dob'
      );

      if (freshAgent) {
        // Link the agent to the user's account in the database
        await User.findByIdAndUpdate(decoded.id, {
          $addToSet: { connectedAgents: freshAgent._id }
        });
        activeAgent = freshAgent;
      }
    }
    
    if (!activeAgent && user.connectedAgents && user.connectedAgents.length > 0) {
      activeAgent = user.connectedAgents[user.connectedAgents.length - 1];
    }
    
    let isOnline = false;
    let lastSeenDisplay = "Offline";
    let signedPhotoUrl = null;

    if (activeAgent) {
      // 🛡️ SECURITY FIX 4: Explicitly select fields here as well during deep database lookup
      const freshAgent = await Agent.findById(activeAgent._id)
        .select('firstName lastName photoUrl occupation program bio slug lastActive gender dob createdAt')
        .lean();
      
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

      // --- CORRECTED SIGNING LOGIC ---
      if (activeAgent.photoUrl) {
        signedPhotoUrl = await getPrivateUrl(activeAgent.photoUrl);
      }
    }

    // Fallback Avatar if no photo exists or signing failed
    if (!signedPhotoUrl && activeAgent) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${activeAgent.firstName}+${activeAgent.lastName}&background=0D1117&color=fff&size=128`;
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
    // 🛡️ SECURITY FIX 5: Hand the error down smoothly to the central filter to hide technical data
    next(err);
  }
});
// 🛡️ SECURITY FIX 1: Include 'next' in route parameters for global safety interception
app.put('/api/users/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res, next) => {
  try {
    await connectToDatabase();
    const s3Client = getS3Client(); 

    const { firstName, lastName, dob, gender, city, state, phone } = req.body;
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User identity not found in token" });
    }

    // --- PARSE AND SAFE-GUARD PHONE SUB-OBJECT ---
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

    // Safety fallback parsing checks to prevent invalid schemas crashing Mongoose validation engine
    const updateData = {
      firstName: firstName ? String(firstName).trim() : "",
      lastName: lastName ? String(lastName).trim() : "",
      phone: parsedPhone, 
      dob,
      gender: gender && typeof gender === 'string' ? gender.toLowerCase().trim() : undefined,
      city: city ? String(city).trim() : "",
      state: state ? String(state).trim() : "",
      isProfileComplete: true,
      isVerified: true
    };

    if (req.body.profileImage) {
      delete req.body.profileImage;
    }

    // 🛡️ SECURITY FIX 2: Hardened File Type & Extension Verification
    if (req.file) {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const allowedExtensions = /.(jpg|jpeg|png|webp)$/i;

      // Verify mimetype and clean file extension naming structures
      if (!allowedMimeTypes.includes(req.file.mimetype) || !allowedExtensions.test(req.file.originalname)) {
        return res.status(400).json({ 
          success: false, 
          message: "Security Violation: Unsupported file type payload dropped." 
        });
      }

      // Completely random key filename to prevent directory path traversal injection tricks
      const fileExtension = req.file.originalname.split('.').pop();
      const cryptoKey = crypto.randomBytes(16).toString('hex');
      const fileKey = `users/${userId}-${cryptoKey}.${fileExtension}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      await s3Client.send(new PutObjectCommand(uploadParams));
      updateData.photoUrl = fileKey; 
      
      console.log(`[Storage] Clean Photo uploaded for User: ${userId}`);
    }
    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      updateData,
      { new: true, runValidators: true }
    ).select('email firstName lastName isProfileComplete city state photoUrl phone');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User account not found" });
    }
    return res.json({ 
      success: true, 
      message: "Onboarding complete", 
      user: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        isProfileComplete: updatedUser.isProfileComplete,
        photoUrl: updatedUser.photoUrl
      }
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 5: Hand the exception details to the bottom centralized error handler
    next(err);
  }
});

// 🛡️ SECURITY FIX 1: Add 'next' parameter to route arguments
app.get('/api/agents/:slug', async (req, res, next) => {
  try {
    console.log("--- Profile Request Start --- for:", req.params.slug);
    
    // 🛡️ SECURITY FIX 2: Strict parameter validation
    // Block any attempt to send objects, regex wildcards, or malicious long vectors
    if (!req.params.slug || typeof req.params.slug !== 'string' || req.params.slug.length > 60) {
      return res.status(400).json({ success: false, message: "Invalid lookup identifier syntax." });
    }

    await connectToDatabase();
    const AgentModel = getAgentModel(); 

    if (!AgentModel) {
      return res.status(500).json({ message: "Configuration Error: Agent Model not found" });
    }

    // 🛡️ SECURITY FIX 3: Removed RegExp object instantiation completely to defeat ReDoS attacks.
    // Instead, look up using standard matching, and force select only public assets.
    const cleanSlug = req.params.slug.trim();
    const agent = await AgentModel.findOne({ 
      slug: cleanSlug 
    })
    .select('firstName lastName photoUrl occupation program bio slug lastActive gender dob createdAt')
    .lean();
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }
    if (agent.photoUrl) {
      agent.photoUrl = await getPrivateUrl(agent.photoUrl);
    } else {
      agent.photoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    console.log("--- Profile Request Success ---");
    
    // 🛡️ SECURITY FIX 5: Explicitly hand back an insulated layout package
    return res.json({
      success: true,
      agent: {
        id: agent._id,
        firstName: agent.firstName || "",
        lastName: agent.lastName || "",
        photoUrl: agent.photoUrl,
        occupation: agent.occupation || "",
        program: agent.program || "",
        bio: agent.bio || "",
        slug: agent.slug
      }
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 6: Hand error management over to the centralized interceptor wall
    next(err);
  }
});
// 🛡️ SECURITY FIX 1: Add 'next' parameter to leverage the central interceptor
app.put('/api/agents/update-profile', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    // Explicitly load only the verification flags and password hashes required for validation loops
    const agent = await AgentModel.findById(req.user.id).select('+password +unlockedVoiceIds');
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found" });
    }

    const { 
      firstName, lastName, occupation, program, bio, address, 
      gender, dob, voiceId, voiceDisplayName, voiceSettings,
      oldPassword, newPassword 
    } = req.body;

    // Handle Password Updates
    if (newPassword && String(newPassword).trim() !== "") {
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
      agent.password = await bcrypt.hash(String(newPassword), salt);
    }

    // 🛡️ SECURITY FIX 2: Strict Explicit Mutate Assignment (Protects against Mass Assignment payload injections)
    if (firstName !== undefined) agent.firstName = String(firstName).trim();
    if (lastName !== undefined) agent.lastName = String(lastName).trim();
    if (occupation !== undefined) agent.occupation = String(occupation).trim();
    if (program !== undefined) agent.program = String(program).trim();
    if (bio !== undefined) agent.bio = String(bio).trim();
    if (address !== undefined) agent.address = String(address).trim();
    if (gender !== undefined) agent.gender = String(gender).toLowerCase().trim();
    if (dob !== undefined) agent.dob = dob;

    // Voice Licensing Access Control Layer
    if (voiceId !== undefined) {
      if (voiceId === null) {
        agent.voiceId = null;
      } else {
        const hasLicense = agent.unlockedVoiceIds && agent.unlockedVoiceIds.includes(String(voiceId));
        
        if (hasLicense) {
          agent.voiceId = String(voiceId);
        } else {
          return res.status(403).json({ 
            success: false, 
            message: "Unauthorized: Active license configuration required for this voice identity." 
          });
        }
      }
    }

    if (voiceDisplayName !== undefined) {
      agent.voiceDisplayName = String(voiceDisplayName).trim();
    }
    
    if (voiceSettings && typeof voiceSettings === 'object') {
      agent.voiceSettings = {
        ...agent.voiceSettings,
        ...voiceSettings
      };
    }

    await agent.save();
    console.log(`[SECURITY SYNC] Profile synchronized for: ${agent.email}`);

    // 🛡️ SECURITY FIX 3: Strict Response Whitelisting DTO
    // Completely replaces raw object spreading so internal database structures never leak over network calls.
    return res.json({
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
    // 🛡️ SECURITY FIX 4: Route exceptions through next to strip out unhandled database crashes
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ROUTE 1: GET /api/users/me
// =========================================================================
app.get('/api/users/me', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    // 1. Explicitly pull only required properties from the database layer
    const user = await User.findById(req.user.id)
      .select('firstName lastName email phone dob gender city state photoUrl isProfileComplete connectedAgents')
      .populate({
        path: 'connectedAgents',
        select: '_id name firstName lastName slug photoUrl avatarUrl profileImage'  
      });
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let signedPhotoUrl = user.photoUrl || null;

    if (signedPhotoUrl && !signedPhotoUrl.startsWith('data:') && !signedPhotoUrl.startsWith('http')) {
      try {
        signedPhotoUrl = await getPrivateUrl(signedPhotoUrl);
      } catch (err) {
        console.error("Failed to sign user photo URL:", err.message);
        signedPhotoUrl = user.photoUrl; 
      }
    }

    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${user.firstName || 'User'}+${user.lastName || ''}&background=0D1117&color=fff&size=128`;
    }

    const userObj = user.toObject();

    if (userObj.connectedAgents && userObj.connectedAgents.length > 0) {
      userObj.connectedAgents = await Promise.all(
        userObj.connectedAgents.map(async (agent) => {
          const rawAgentImage = agent.profileImage || agent.avatarUrl || agent.photoUrl || "";

          if (rawAgentImage && !rawAgentImage.startsWith('http') && !rawAgentImage.startsWith('data:')) {
            try {
              agent.photoUrl = await getPrivateUrl(rawAgentImage);
            } catch (err) {
              console.error(`Failed to sign URL for agent ${agent._id}:`, err.message);
              agent.photoUrl = rawAgentImage; 
            }
          } else {
            agent.photoUrl = rawAgentImage; 
          }
          return agent;
        })
      );
    }

    // 2. 🛡️ SECURITY FIX: Explicit Whitelist Presentation Mapping (No raw leak)
    return res.json({ 
      success: true, 
      user: {
        id: userObj._id,
        email: userObj.email,
        firstName: userObj.firstName || "",
        lastName: userObj.lastName || "",
        phone: userObj.phone || {},
        dob: userObj.dob || null,
        gender: userObj.gender || "",
        city: userObj.city || "",
        state: userObj.state || "",
        isProfileComplete: !!userObj.isProfileComplete,
        photoUrl: signedPhotoUrl,
        connectedAgents: userObj.connectedAgents || []
      } 
    });

  } catch (err) {
    // Pipe smoothly down to the absolute bottom global error interceptor
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ROUTE 2: PUT /api/users/update-profile
// =========================================================================
app.put('/api/users/update-profile', authenticateToken, upload.single('photo'), async (req, res, next) => {
  try {
    await connectToDatabase();
    const userId = req.user.id;
    const { firstName, lastName, phone, dob, gender, city, state } = req.body;

    // Parse and safeguard phone parameters cleanly
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
        if (typeof phone === 'string' && phone.includes('[object Object]')) {
          parsedPhone.raw = "";
        } else {
          parsedPhone.raw = String(phone).trim();
        }
      }
    }

    // 3. 🛡️ SECURITY FIX: Defend input parsing from type-juggling payload models
    let updateFields = {
      firstName: firstName ? String(firstName).trim() : undefined, 
      lastName: lastName ? String(lastName).trim() : undefined, 
      phone: parsedPhone, 
      dob: dob || undefined, 
      gender: gender ? String(gender).toLowerCase().trim() : undefined, 
      city: city ? String(city).trim() : undefined, 
      state: state ? String(state).trim() : undefined,
      isProfileComplete: true 
    };

    // 4. 🛡️ SECURITY FIX: Validate incoming multipart file buffers safely
    if (req.file) {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const allowedExtensions = /.(jpg|jpeg|png|webp)$/i;

      if (!allowedMimeTypes.includes(req.file.mimetype) || !allowedExtensions.test(req.file.originalname)) {
        return res.status(400).json({ 
          success: false, 
          message: "Unsupported attachment payload signature." 
        });
      }

      try {
        const storageKey = await uploadToS3(req.file, `users/${userId}`);
        updateFields.photoUrl = storageKey; 
      } catch (uploadErr) {
        console.error("Storage upload failed:", uploadErr);
        return res.status(500).json({ success: false, message: "Failed to process image upload" });
      }
    }

    // Remove empty parameters to prevent overwriting existing model data with undefined keys
    Object.keys(updateFields).forEach(key => updateFields[key] === undefined && delete updateFields[key]);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true } 
    ).populate({
      path: 'connectedAgents',
      select: '_id id name firstName lastName slug photoUrl avatarUrl profileImage' 
    });

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User account connection drop." });
    }

    let signedPhotoUrl = updatedUser.photoUrl || null;
    
    if (signedPhotoUrl && !signedPhotoUrl.startsWith('data:') && !signedPhotoUrl.startsWith('http')) {
      try {
        signedPhotoUrl = await getPrivateUrl(signedPhotoUrl);
      } catch (err) {
        console.error("Failed to sign user avatar private URL:", err.message);
        signedPhotoUrl = updatedUser.photoUrl;
      }
    }

    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${updatedUser.firstName || 'User'}+${updatedUser.lastName || ''}&background=0D1117&color=fff&size=128`;
    }

    const updatedUserObj = updatedUser.toObject();
    
    if (updatedUserObj.connectedAgents && updatedUserObj.connectedAgents.length > 0) {
      updatedUserObj.connectedAgents = await Promise.all(
        updatedUserObj.connectedAgents.map(async (agent) => {
          const rawAgentImage = agent.profileImage || agent.avatarUrl || agent.photoUrl || "";

          if (rawAgentImage && !rawAgentImage.startsWith('http') && !rawAgentImage.startsWith('data:')) {
            try {
              agent.photoUrl = await getPrivateUrl(rawAgentImage);
            } catch (err) {
              console.error(`Failed to sign URL for agent ${agent._id}:`, err.message);
              agent.photoUrl = rawAgentImage;
            }
          } else {
            agent.photoUrl = rawAgentImage;
          }
          return agent;
        })
      );
    }

    // 5. 🛡️ SECURITY FIX: Clean response mapping structure wrapper
    return res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUserObj._id,
        email: updatedUserObj.email,
        firstName: updatedUserObj.firstName || "",
        lastName: updatedUserObj.lastName || "",
        phone: updatedUserObj.phone || {},
        dob: updatedUserObj.dob || null,
        gender: updatedUserObj.gender || "",
        city: updatedUserObj.city || "",
        state: updatedUserObj.state || "",
        isProfileComplete: !!updatedUserObj.isProfileComplete,
        photoUrl: signedPhotoUrl,
        connectedAgents: updatedUserObj.connectedAgents || []
      }
    });

  } catch (err) {
    // Send unhandled parsing or query failures down to the global interceptor wall
    next(err);
  }
});
// =========================================================================
// 🛡️ ROUTE 1: GET /api/subscriptions/rate/:planPrice
// =========================================================================
// Modified: This now acts purely as a validator endpoint or can be removed 
// if your frontend already knows the static NGN prices.
app.get('/api/subscriptions/rate/:planPrice', async (req, res, next) => {
  try {
    const { planPrice } = req.params;
    
    if (!planPrice || isNaN(Number(planPrice))) {
      return res.status(400).json({ success: false, message: "Invalid evaluation price." });
    }

    // Returns the exact pure Naira value passed in without conversions
    return res.json({
      success: true,
      ngn: Number(planPrice)
    });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ROUTE 2: POST /api/subscriptions/verify
// =========================================================================
app.post('/api/subscriptions/verify', async (req, res, next) => {
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

    // The client only tells us the transaction_id and the intended plan.
    const { transaction_id, plan } = req.body;

    if (!transaction_id || !plan) {
      return res.status(400).json({ message: "Transaction ID and target plan choice are required" });
    }

    // 🛡️ PURE NAIRA SOURCE OF TRUTH: Define your exact pricing in NGN on the server
    const planPricesInNGN = {
      'BASIC': 8500,          // e.g., ₦8,500
      'GROWTH': 43500,         // e.g., ₦43,500
      'PROFESSIONAL': 88500    // e.g., ₦88,500
    };

    const targetPlan = String(plan).toUpperCase().trim();
    if (!planPricesInNGN[targetPlan]) {
      return res.status(400).json({ success: false, message: "Invalid tier classification choice." });
    }
    const expectedNairaPrice = planPricesInNGN[targetPlan];
    const response = await flw.Transaction.verify({ id: transaction_id });
    const data = response.data;
        if (
      data.status === "successful" &&
      data.currency === "NGN" &&
      Number(data.amount) >= expectedNairaPrice
    ) {
      
      const now = new Date();
      let expiry = new Date();

      if (targetPlan === 'BASIC') {
        expiry.setMonth(now.getMonth() + 1);
      } else if (targetPlan === 'GROWTH') {
        expiry.setMonth(now.getMonth() + 6);
      } else if (targetPlan === 'PROFESSIONAL') {
        expiry.setFullYear(now.getFullYear() + 1);
      }

      // Explicit selection projection wrapper during assignment update
      const updatedAgent = await Agent.findByIdAndUpdate(
        decoded.id,
        {
          $set: {
            isSubscribed: true,
            plan: targetPlan,
            subscriptionDate: now,
            expiryDate: expiry, 
            expiryNotificationSent: false,
            lastTransactionId: String(transaction_id),
            paymentDetails: {
              amountNgn: data.amount,
              currency: "NGN",
              verifiedAt: now
            }
          }
        },
        { new: true }
      ).select('firstName lastName email plan isSubscribed expiryDate');

      if (!updatedAgent) {
        return res.status(404).json({ message: "Agent profile mapping context missing." });
      }

      console.log(`Subscription ACTIVATED for: ${updatedAgent.email} | Amount: ₦${data.amount}`);

      // Structured presentation return DTO (Zero token/session leaks)
      return res.json({
        success: true,
        message: "Payment verified successfully. Secure node activated.",
        agent: {
          id: updatedAgent._id,
          email: updatedAgent.email,
          plan: updatedAgent.plan,
          isSubscribed: !!updatedAgent.isSubscribed,
          expiryDate: updatedAgent.expiryDate
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Paid amount does not match plan price index expectations."
      });
    }

  } catch (err) {
    // Redirect to the bottom centralized global error interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: GET /api/agents/my-users
// =========================================================================
app.get('/api/agents/my-users', authenticateToken, async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    await connectToDatabase();
    
    const agentId = req.user?.id || req.user?._id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const ActiveUserModel = mongoose.models.User || User;
    
    // Fetch users with lean execution
    const users = await ActiveUserModel.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl gender city state isVerified isProfileComplete lastLogin lastActive createdAt')
      .sort({ lastActive: -1 })
      .lean();

    // Compile unread counts across messages safely
    const unreadCountsData = await Message.aggregate([
      { 
        $match: { 
          receiverId: new mongoose.Types.ObjectId(String(agentId)),
          receiverModel: 'Agent', 
          status: { $in: ['sent', 'delivered'] }
        } 
      },
      { 
        $group: { 
          _id: "$senderId", // Keep as raw ObjectId for absolute mapping compatibility
          count: { $sum: 1 } 
        } 
      }
    ]);

    // Build the unread count map using clean string keys
    const unreadMap = unreadCountsData.reduce((acc, item) => {
      if (item._id) {
        acc[item._id.toString()] = item.count;
      }
      return acc;
    }, {});

    const nowTimestamp = Date.now();

    // Process users and securely map cloud storage identifiers
    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      if (user.photoUrl && typeof user.photoUrl === 'string') {
        if (user.photoUrl.startsWith('data:') || user.photoUrl.startsWith('http')) {
          finalPhotoUrl = user.photoUrl;
        } else {
          try {
            let fileKey = user.photoUrl;
            if (fileKey.includes('.com/')) fileKey = fileKey.split('.com/')[1].split('?')[0];
            let cleanKey = fileKey.startsWith('/') ? fileKey.slice(1) : fileKey;
            
            finalPhotoUrl = await getPrivateUrl(cleanKey);
          } catch (s3Err) {
            console.error(`[S3 Error] Failed to sign photo for ${user._id}:`, s3Err.message);
            finalPhotoUrl = null; // Let the avatar fallback take over instead of leaking raw key paths
          }
        }
      }

      if (!finalPhotoUrl) {
        const name = encodeURIComponent(`${user.firstName || 'U'} ${user.lastName || ''}`);
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
      }

      const lastSeen = user.lastActive || user.lastLogin;
      const isOnline = lastSeen && new Date(lastSeen) > new Date(nowTimestamp - 5 * 60 * 1000);
      const userStringId = user._id.toString();

      // 🛡️ SECURITY FIX: Map explicit keys one by one. Do not use ...user spreading.
      return {
        id: userStringId,
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
        createdAt: user.createdAt
      };
    }));

    return res.json({
      success: true,
      count: processedUsers.length,
      users: processedUsers
    });

  } catch (err) {
    // 🛡️ SECURITY FIX: Route safely through your global interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: GET /api/messages/:otherUserId
// =========================================================================
app.get('/api/messages/:otherUserId', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;

    // 🛡️ SECURITY FIX 1: Strict Hex-Id Parameter Structure Validation
    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid target identifier structure." });
    }
    
    // 🛡️ SECURITY FIX 2: Upper Ceiling Pagination Limits (Defeats Memory Exhaustion Attacks)
    let limit = parseInt(req.query.limit, 10) || 30;
    let skip = parseInt(req.query.skip, 10) || 0;

    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100; // Enforce hard maximum ceiling cap per network page frame
    if (skip < 0) skip = 0;

    // Fetch messages cleanly with index matching
    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) 
    .skip(skip)
    .limit(limit)
    .lean();

    // Fetch user data safely
    const userData = await mongoose.model('User').findById(otherUserId)
      .select('firstName lastName email gender status isOnline lastActive photoUrl city state')
      .lean();

    let formattedUser = null;
    if (userData) {
      // 🛡️ SECURITY FIX 3: Safe DTO Object Builder (No raw leakage)
      formattedUser = {
        id: userData._id,
        firstName: userData.firstName || "",
        lastName: userData.lastName || "",
        email: userData.email || "",
        gender: userData.gender || "Not Specified",
        city: userData.city || "",
        state: userData.state || ""
      };
    }

    // Process presigned assets safely inside limited loops
    const signedMessages = await Promise.all(messages.map(async (m) => {
      // Create a secure presentation object to avoid returning raw database document footprints
      const processedMsg = {
        id: m._id,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content || "",
        fileUrl: null,
        status: m.status || "sent",
        createdAt: m.createdAt
      };

      if (m.fileUrl) {
        let fileKey = m.fileUrl;
        if (fileKey.startsWith('http')) {
          const urlParts = fileKey.split('idrivee2.com/');
          if (urlParts.length > 1) {
            fileKey = urlParts[1].split('/').slice(1).join('/'); 
          }
        }
        try {
          processedMsg.fileUrl = await getPrivateUrl(fileKey);
        } catch (s3Err) {
          console.error(`[S3 Chat Error] URL signing failure for message ${m._id}:`, s3Err.message);
          processedMsg.fileUrl = null; // Suppress leakage of raw path keys
        }
      }
      return processedMsg;
    }));

    // Return sanitized outputs to the frontend client layout
    return res.json({ 
      success: true, 
      messages: signedMessages.reverse(),
      user: formattedUser 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 4: Safely forward to the global catch interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/save-subscription
// =========================================================================
app.post('/api/save-subscription', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Identity context not found in token." });
    }

    const { subscription } = req.body;
    
    // 🛡️ SECURITY FIX 1: Input Presence Validation
    if (!subscription || typeof subscription !== 'object') {
      return res.status(400).json({ success: false, message: "Invalid push registration subscription payload." });
    }

    if (!subscription.endpoint) {
      return res.status(400).json({ success: false, message: "Missing required push gateway registration endpoint." });
    }
    const sanitizedSubscription = {
      endpoint: String(subscription.endpoint).trim(),
      expirationTime: subscription.expirationTime || null,
      keys: {
        p256dh: subscription.keys?.p256dh ? String(subscription.keys.p256dh).trim() : "",
        auth: subscription.keys?.auth ? String(subscription.keys.auth).trim() : ""
      }
    };
    let TargetModel;
    if (req.user.role === 'agent') {
      TargetModel = getAgentModel(); // Using your model getter function
    } else {
      TargetModel = mongoose.models.User || User;
    }

    // Update using atomic $set operation
    const updatedProfile = await TargetModel.findByIdAndUpdate(
      userId, 
      { $set: { pushSubscription: sanitizedSubscription } },
      { new: true, runValidators: true }
    );

    if (!updatedProfile) {
      return res.status(404).json({ success: false, message: "Profile tracking match not found." });
    }

    return res.json({ 
      success: true, 
      message: "Push notifications successfully registered and activated." 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 4: Pipe directly out through your global error handling interception middleware
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/messages/send
// =========================================================================
app.post('/api/messages/send', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { receiverId, text, receiverModel } = req.body;
    const myId = req.user.id;

    // 🛡️ SECURITY FIX 1: Explicit Input Structure and Hex ID Validation
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, message: "Message text cannot be blank." });
    }

    if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ success: false, message: "Invalid recipient identifier structure." });
    }

    // 🛡️ SECURITY FIX 2: Strict Model Whitelisting (Blocks Dynamic Model Injection)
    const sanitizedModel = String(receiverModel).trim();
    if (!['Agent', 'User'].includes(sanitizedModel)) {
      return res.status(400).json({ success: false, message: "Unsupported receiver routing model categorization." });
    }

    const senderRole = req.user.role === 'agent' ? 'Agent' : 'User';

    // 1. Create and Save Message with sanitized input data lengths
    const newMessage = new Message({
      senderId: myId,
      senderModel: senderRole,
      receiverId: new mongoose.Types.ObjectId(String(receiverId)),
      receiverModel: sanitizedModel, 
      text: String(text).trim(),
      notificationSent: false 
    });
    await newMessage.save();

    // 2. Fetch Receiver and Sender for notification context cleanly using getters
    const TargetModel = sanitizedModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
    const receiver = await TargetModel.findById(receiverId).select('+pushSubscription +lastNotificationEmail +email firstName lastName');
    
    const SenderModel = senderRole === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
    const sender = await SenderModel.findById(myId).select('firstName lastName');

    if (!receiver) {
      return res.status(404).json({ success: false, message: "Recipient entity match not found." });
    }

    // 3. Socket.io Online Gateway Validation
    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString()) || false;

    // 4. Handle Web-Push Reminders
    if (receiver.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        const payload = JSON.stringify({
          title: `New Message from ${sender?.firstName || 'Zing'}`,
          body: text.length > 60 ? `${text.substring(0, 60)}...` : text,
          data: { 
            url: sanitizedModel === 'Agent' 
              ? `/agent/dashboard?userId=${myId}` 
              : `/user/dashboard?agentId=${myId}` 
          }
        });

        await webpush.sendNotification(receiver.pushSubscription, payload);
        
        // Use an atomic update to safely flag delivery status changes
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
        newMessage.notificationSent = true;
      } catch (pushErr) {
        console.error("Push delivery failed:", pushErr.message);
      }
    }

    // 5. 🛡️ SECURITY FIX 3: Atomic Lockout Strategy (Defeats Email Race Conditions)
    if (!isOnline) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const now = Date.now();
        const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (now - lastEmailTime > COOLDOWN) {
          // 🌟 CRITICAL FIX: Run the atomic update BEFORE triggering the long-running email await operation.
          // This immediately blocks concurrent incoming route executions from bypassing the cooldown block.
          await TargetModel.findByIdAndUpdate(receiverId, { 
            $set: { lastNotificationEmail: new Date(now) } 
          });

          await sendOfflineNotification(receiver, sender, text, sanitizedModel);
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    // 6. Real-Time WebSocket Emit
    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", {
        id: newMessage._id,
        senderId: newMessage.senderId,
        senderModel: newMessage.senderModel,
        receiverId: newMessage.receiverId,
        content: newMessage.text,
        createdAt: newMessage.createdAt
      });
    }

    // 🛡️ SECURITY FIX 4: Explicit Data Presentation Layer Output Mapping
    return res.status(201).json({ 
      success: true, 
      message: {
        id: newMessage._id,
        senderId: newMessage.senderId,
        receiverId: newMessage.receiverId,
        content: newMessage.text,
        createdAt: newMessage.createdAt
      } 
    });

  } catch (err) {
    // Forward unexpected failures smoothly into the central error interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED CHAT FETCH ROUTE (OFFSET CHRONOLOGY STABILIZED)
// =========================================================================
app.get('/api/messages/:otherUserId', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;

    // 1. 🛡️ SECURITY FIX: Hex ID Structural Syntax Filter
    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid chat target identifier structure." });
    }

    // 2. 🛡️ SECURITY FIX: Strict Ceiling Boundaries on Pagination Input
    let limit = parseInt(req.query.limit, 10) || 30;
    let skip = parseInt(req.query.skip, 10) || 0;

    if (limit <= 0) limit = 30;
    if (limit > 100) limit = 100; // Cap at 100 to protect Netlify Function runtime memory
    if (skip < 0) skip = 0;

    // 3. Fetch chat history logs
    // We sort by newest first (-1) to ensure we slice the immediate preceding batch window correctly
    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) 
    .skip(skip)
    .limit(limit)
    // 🛡️ SECURITY FIX: Dynamic polymorphic lookup declaration 
    // This tells Mongoose to look inside the senderModel/receiverModel fields to find the right collection
    .populate({ path: 'senderId', select: 'firstName lastName photoUrl slug', refPath: 'senderModel' })
    .populate({ path: 'receiverId', select: 'firstName lastName photoUrl slug', refPath: 'receiverModel' })
    .lean();

    // Flip the array back chronological order (oldest to newest) for proper visual UI rendering
    const chronologicalMessages = messages.reverse();

    // 4. Map, sign, and insulate object return schemas securely
    const processedMessages = await Promise.all(chronologicalMessages.map(async (m) => {
      // Build a strict DTO representation wrapper to block internal database parameters
      const msgDto = {
        id: m._id,
        content: m.text || "",
        fileUrl: null,
        createdAt: m.createdAt,
        sender: m.senderId ? {
          id: m.senderId._id,
          firstName: m.senderId.firstName || "",
          lastName: m.senderId.lastName || "",
          photoUrl: m.senderId.photoUrl || ""
        } : null,
        receiver: m.receiverId ? {
          id: m.receiverId._id,
          firstName: m.receiverId.firstName || "",
          lastName: m.receiverId.lastName || ""
        } : null
      };

      // Secure private bucket parsing strategy
      if (m.fileUrl && typeof m.fileUrl === 'string') {
        let fileKey = m.fileUrl;
        if (fileKey.startsWith('http')) {
          const urlParts = fileKey.split('idrivee2.com/');
          if (urlParts.length > 1) {
            // Clean up extraction path to prevent leading slash parsing errors
            const pathParts = urlParts[1].split('/');
            fileKey = pathParts.slice(1).join('/'); 
          }
        }
        try {
          msgDto.fileUrl = await getPrivateUrl(fileKey);
        } catch (s3Err) {
          console.error(`[S3 Chat Error] Presigned URL generation dropped for message ${m._id}:`, s3Err.message);
          msgDto.fileUrl = null; // Do not leak raw cloud keys or bucket paths on error
        }
      }
      return msgDto;
    }));

    return res.json({ 
      success: true, 
      count: processedMessages.length,
      messages: processedMessages 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX: Pass database/parsing execution faults safely to your global interceptor handler
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ROUTE 1: GET /api/portal/dashboard
// =========================================================================
app.get('/api/portal/dashboard', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
        const agent = await Agent.findById(req.user.id)
      .select('firstName lastName email occupation program bio address gender dob plan isSubscribed expiryDate');
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found." });
    }
    return res.json({
      success: true,
      agent: {
        id: agent._id,
        firstName: agent.firstName || "",
        lastName: agent.lastName || "",
        email: agent.email || "",
        occupation: agent.occupation || "",
        program: agent.program || "",
        bio: agent.bio || "",
        address: agent.address || "",
        gender: agent.gender || "Not Specified",
        dob: agent.dob || null,
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed,
        expiryDate: agent.expiryDate || null
      }
    });
  } catch (err) {
    // Pipe smoothly to the global error handler
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ROUTE 2: POST /api/save-subscription
// =========================================================================
app.post('/api/save-subscription', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();    
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing context token identifier." });
    }

    // Capture the body signature safely
    const incomingSub = req.body.subscription || req.body;

    if (!incomingSub || !incomingSub.endpoint) {
      return res.status(400).json({ success: false, message: "Invalid subscription payload signature data." });
    }

    // 🛡️ SECURITY FIX 1: Strict Nested Parameter Whitelisting (Web Push W3C Compliant)
    const sanitizedSubscription = {
      endpoint: String(incomingSub.endpoint).trim(),
      expirationTime: incomingSub.expirationTime || null,
      keys: {
        p256dh: incomingSub.keys?.p256dh ? String(incomingSub.keys.p256dh).trim() : "",
        auth: incomingSub.keys?.auth ? String(incomingSub.keys.auth).trim() : ""
      }
    };
    const userRole = req.user.role === 'agent' ? 'agent' : 'user';
    const TargetModel = userRole === 'agent' ? getAgentModel() : (mongoose.models.User || User);

    const updated = await TargetModel.findByIdAndUpdate(
      userId,
      { $set: { pushSubscription: sanitizedSubscription } },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Account mapping drop." });
    }

    console.log(`[Push Success] Subscription securely whitelisted and saved for ${userRole}: ${userId}`);
    return res.json({ success: true, message: "Push credentials synchronized successfully." });

  } catch (err) {
    // Send unhandled parsing or query crashes to the bottom centralized firewall interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/messages/upload
// =========================================================================
app.post('/api/messages/upload', authenticateToken, upload.single('file'), async (req, res, next) => {
  try {
    await connectToDatabase(); 

    let connectionRetries = 0;
    while (mongoose.connection.readyState !== 1 && connectionRetries < 5) {
      console.log(`⏳ DB stabilizing for upload... Attempt ${connectionRetries + 1}`);
      await new Promise(resolve => setTimeout(resolve, 400)); 
      connectionRetries++;
    }

    if (mongoose.connection.readyState !== 1) {
      throw new Error(`Database connection not ready. State: ${mongoose.connection.readyState}`);
    }

    const { receiverId, text } = req.body; 
    
    // 🛡️ SECURITY FIX 1: Explicit Request File & Hex ID Signature Checking
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });
    if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ success: false, message: "Invalid chat recipient signature structural context." });
    }

    // 🛡️ SECURITY FIX 2: Strict White-list Naming & Magic Mimetype Enforcement
    const allowedMimeTypes = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov'
    };

    const mimeType = req.file.mimetype;
    if (!allowedMimeTypes[mimeType]) {
      return res.status(400).json({ success: false, message: "Unsupported file attachment payload metadata signature." });
    }

    // Determine target extension strictly using server mappings instead of trust-matching original extensions
    const safeExtension = allowedMimeTypes[mimeType];
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${safeExtension}`;

    // Execute Safe Memory Chunk Upload to Storage Gateway
    const parallelUploads3 = new Upload({
      client: s3Client, 
      params: {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: mimeType,
      },
    });
    await parallelUploads3.done();

    const isAgent = req.user.role === 'agent';
    const receiverModel = isAgent ? 'User' : 'Agent';
    const senderModel = isAgent ? 'Agent' : 'User';

    // Save Message to Database
    const newMessage = new Message({
      senderId: new mongoose.Types.ObjectId(String(req.user.id)),
      senderModel,
      receiverId: new mongoose.Types.ObjectId(String(receiverId)),
      receiverModel,
      text: text ? String(text).trim() : "", 
      fileUrl: fileName, 
      fileType: detectedType,
      status: 'sent',
      notificationSent: false
    });
    await newMessage.save();

    // NOTIFICATION LOGIC (SPEED OPTIMIZED VIA REDIS)
    const redis = req.app.get('redisClient');
    let receiver = null;
    let sender = null;

    if (redis) {
      try {
        const [cachedReceiver, cachedSender] = await Promise.all([
          redis.get(`profile:${receiverId}`),
          redis.get(`profile:${req.user.id}`)
        ]);
        if (cachedReceiver) receiver = JSON.parse(cachedReceiver);
        if (cachedSender) sender = JSON.parse(cachedSender);
      } catch (redisErr) {
        console.error("⚠️ Redis Read Failure on Media Upload fallback to Mongo:", redisErr.message);
      }
    }

    if (!receiver) {
      const TargetModel = receiverModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
      receiver = await TargetModel.findById(receiverId).lean();
      if (receiver && redis) {
        await redis.setEx(`profile:${receiverId}`, 1800, JSON.stringify(receiver)).catch(() => {});
      }
    }

    if (!sender) {
      const SenderModel = isAgent ? getAgentModel() : (mongoose.models.User || User);
      sender = await SenderModel.findById(req.user.id).lean();
      if (sender && redis) {
        await redis.setEx(`profile:${req.user.id}`, 1800, JSON.stringify(sender)).catch(() => {});
      }
    }

    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString()) || false;

    // Web Push Notification Routing Logic
    if (receiver?.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        const payload = JSON.stringify({
          title: `New ${detectedType} from ${sender?.firstName || 'Zing'}`,
          body: text ? (text.length > 60 ? `${text.substring(0, 60)}...` : text) : (detectedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo"),
          data: {
            url: isAgent ? `/user/dashboard` : `/agent/dashboard?userId=${req.user.id}`
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
      } catch (pushErr) {
        console.error("Media Push delivery failed:", pushErr.message);
      }
    }

    // 🛡️ SECURITY FIX 3: Atomic Lockout Strategy (Defeats Cache Cooldown Race Conditions)
    if (!isOnline && receiver) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const nowTimestamp = Date.now();
        const lastEmail = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (nowTimestamp - lastEmail > COOLDOWN) {
          const TargetModel = receiverModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
          
          // Update the database BEFORE executing the long-running email await trigger
          await TargetModel.findByIdAndUpdate(receiverId, { 
            $set: { lastNotificationEmail: new Date(nowTimestamp) } 
          });

          // 🌟 CRITICAL CACHE SYNC: Evict the stale Redis profile index immediately.
          // This forces subsequent calls to pull the updated timestamp from the DB.
          if (redis) {
            await redis.del(`profile:${receiverId}`).catch(() => {});
          }

          await sendOfflineNotification(receiver, sender, text || "", fileName, detectedType, receiverModel);
          console.log(`[Email] Offline media notification sent to ${receiver.email}`);
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", {
        id: newMessage._id,
        senderId: newMessage.senderId,
        receiverId: newMessage.receiverId,
        content: newMessage.text,
        fileUrl: await getPrivateUrl(fileName),
        fileType: newMessage.fileType,
        createdAt: newMessage.createdAt
      });
    }

    // 🛡️ SECURITY FIX 4: Explicit DTO Mapping Response Format
    return res.status(201).json({ 
      success: true, 
      message: {
        id: newMessage._id,
        senderId: newMessage.senderId,
        receiverId: newMessage.receiverId,
        content: newMessage.text,
        fileUrl: await getPrivateUrl(fileName),
        fileType: newMessage.fileType,
        createdAt: newMessage.createdAt
      } 
    });

  } catch (err) {
    // Pass errors down to the global exception boundary interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/messages/get-upload-url
// =========================================================================
app.post('/api/messages/get-upload-url', authenticateToken, async (req, res, next) => {
  try {
    const { fileName, fileType } = req.body;
    
    // 🛡️ SECURITY FIX 1: Input Presence Checking
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "File metadata missing." });
    }

    // 🛡️ SECURITY FIX 2: Strict Server-Side Mime-Type White-list Matrix
    // This explicitly maps acceptable content types to safe, single extensions
    const allowedMimeTypes = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov'
    };

    const sanitizedMime = String(fileType).toLowerCase().trim();
    if (!allowedMimeTypes[sanitizedMime]) {
      return res.status(400).json({ 
        success: false, 
        message: "Unsupported file type signature. Only safe images and videos are permitted." 
      });
    }
    const safeExtension = allowedMimeTypes[sanitizedMime];
    const uniqueKey = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${safeExtension}`;
    
    const client = getS3Client();
    const command = new PutObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: uniqueKey,
      ContentType: sanitizedMime, // Forces the storage gateway to store it with the correct HTTP content type header
    });
        const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

    // Return the secure, pre-mapped unique reference token paths back to the client layout
    return res.json({ 
      success: true, 
      uploadUrl, 
      key: uniqueKey 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 4: Prevent raw system file path error traces from escaping out over network responses
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/messages/confirm-upload
// =========================================================================
app.post('/api/messages/confirm-upload', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase(); 

    let connectionRetries = 0;
    while (mongoose.connection.readyState !== 1 && connectionRetries < 5) {
      console.log(`⏳ DB stabilizing for confirmation... Attempt ${connectionRetries + 1}`);
      await new Promise(resolve => setTimeout(resolve, 400)); 
      connectionRetries++;
    }

    if (mongoose.connection.readyState !== 1) {
      throw new Error(`Database connection not ready. State: ${mongoose.connection.readyState}`);
    }

    const { receiverId, text, fileUrl, fileType } = req.body;

    // 🛡️ SECURITY FIX 1: Explicit Request Input Validation & Hex Filter
    if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId) || !fileUrl) {
      return res.status(400).json({ success: false, message: "Required parameter signature targets missing." });
    }

    // 🛡️ SECURITY FIX 2: Path Traversal & Storage Sandbox Isolation
    // Enforce that the provided path must strictly start with your intended namespace folder
    const sanitizedPath = String(fileUrl).trim();
    if (!sanitizedPath.startsWith('chat/') || sanitizedPath.includes('..')) {
      return res.status(400).json({ success: false, message: "Unauthorized file path routing access token." });
    }

    // Strict value enforcement for file types
    const sanitizedType = ['image', 'video'].includes(String(fileType).toLowerCase().trim()) 
      ? String(fileType).toLowerCase().trim() 
      : 'image';

    const redis = req.app.get('redisClient');
    const isAgent = req.user.role === 'agent';
    const receiverModel = isAgent ? 'User' : 'Agent';
    const senderModel = isAgent ? 'Agent' : 'User';

    // Save Message to Database
    const newMessage = new Message({
      senderId: new mongoose.Types.ObjectId(String(req.user.id)),
      senderModel: senderModel,
      receiverId: new mongoose.Types.ObjectId(String(receiverId)),
      receiverModel: receiverModel,
      text: text ? String(text).trim() : "",
      fileUrl: sanitizedPath, 
      fileType: sanitizedType,
      status: 'sent',
      notificationSent: false
    });
    await newMessage.save();

    // FETCH TARGET AND SENDER PROFILE (VIA REDIS PROMISES)
    let receiver = null;
    let sender = null;

    if (redis) {
      try {
        const [cachedReceiver, cachedSender] = await Promise.all([
          redis.get(`profile:${receiverId}`),
          redis.get(`profile:${req.user.id}`)
        ]);
        if (cachedReceiver) receiver = JSON.parse(cachedReceiver);
        if (cachedSender) sender = JSON.parse(cachedSender);
      } catch (redisErr) {
        console.error("⚠️ Redis Read Failure on Confirm Upload:", redisErr.message);
      }
    }

    if (!receiver) {
      const TargetModel = receiverModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
      receiver = await TargetModel.findById(receiverId).lean();
      if (receiver && redis) {
        await redis.setEx(`profile:${receiverId}`, 1800, JSON.stringify(receiver)).catch(() => {});
      }
    }

    if (!sender) {
      const SenderModel = isAgent ? getAgentModel() : (mongoose.models.User || User);
      sender = await SenderModel.findById(req.user.id).lean();
      if (sender && redis) {
        await redis.setEx(`profile:${req.user.id}`, 1800, JSON.stringify(sender)).catch(() => {});
      }
    }

    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString()) || false;

    // Web Push Notification Logic
    if (receiver?.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        const payload = JSON.stringify({
          title: `New ${sanitizedType} from ${sender?.firstName || 'Zing'}`,
          body: text ? (text.length > 60 ? `${text.substring(0, 60)}...` : text) : `Sent an attachment`,
          data: { 
            url: isAgent ? `/user/dashboard` : `/agent/dashboard?userId=${req.user.id}` 
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
      } catch (pushErr) {
        console.error("Push delivery failed:", pushErr.message);
      }
    }

    // 🛡️ SECURITY FIX 3: Atomic Lockout Strategy (Defeats Cache Cooldown Race Conditions)
    if (!isOnline && receiver) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const nowTimestamp = Date.now();
        const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (nowTimestamp - lastEmailTime > COOLDOWN) {
          const TargetModel = receiverModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
          
          // Step A: Immediately flag the database to block racing operations
          await TargetModel.findByIdAndUpdate(receiverId, { 
            $set: { lastNotificationEmail: new Date(nowTimestamp) } 
          });

          // Step B: Wipe the stale cached profile out of Redis memory
          if (redis) {
            await redis.del(`profile:${receiverId}`).catch(() => {});
          }

          // Step C: Trigger your long-running notification worker loop safely
          const emailText = text ? String(text).trim() : `Sent a ${sanitizedType} attachment`;
          await sendOfflineNotification(receiver, sender, emailText, sanitizedPath, sanitizedType, receiverModel);
          console.log(`[Email] Offline notification for ${sanitizedType} sent to ${receiver.email}`);
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    // Construct the private delivery asset for immediate payload returns
    const signedUrlForFrontend = await getPrivateUrl(sanitizedPath);

    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", {
        id: newMessage._id,
        senderId: newMessage.senderId,
        receiverId: newMessage.receiverId,
        content: newMessage.text,
        fileUrl: signedUrlForFrontend,
        fileType: newMessage.fileType,
        createdAt: newMessage.createdAt
      });
    }

    // 🛡️ SECURITY FIX 4: Secure Data Object Mapping Format Return
    return res.status(201).json({ 
      success: true, 
      message: {
        id: newMessage._id,
        senderId: newMessage.senderId,
        receiverId: newMessage.receiverId,
        content: newMessage.text,
        fileUrl: signedUrlForFrontend,
        fileType: newMessage.fileType,
        createdAt: newMessage.createdAt
      }
    });

  } catch (err) {
    // Route clean trace faults safely through the global error interception barrier
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: DELETE /api/messages/:id
// =========================================================================
app.delete('/api/messages/:id', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    const messageId = req.params.id;
    const myId = req.user?.id || req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid message identifier structure." });
    }
    const message = await Message.findOne({ 
      _id: new mongoose.Types.ObjectId(String(messageId)), 
      senderId: new mongoose.Types.ObjectId(String(myId)) 
    });

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: "Message not found or you do not have permission to delete it." 
      });
    }
    if (message.fileUrl && typeof message.fileUrl === 'string') {
      let fileKey = message.fileUrl;
      
      if (fileKey.startsWith('http')) {
        const urlParts = fileKey.split('idrivee2.com/');
        if (urlParts.length > 1) {
          const pathParts = urlParts[1].split('/');
          fileKey = pathParts.slice(1).join('/'); 
        }
      }

      try {
        const client = getS3Client();
        const deleteCommand = new DeleteObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME,
          Key: fileKey
        });
        
        await client.send(deleteCommand);
        console.log(`[S3 Cleanup] Deleted associated asset: ${fileKey}`);
      } catch (s3Err) {
        // Log the error but don't halt execution, so database deletions still go through
        console.error(`[S3 Cleanup Error] Failed to drop asset ${fileKey}:`, s3Err.message);
      }
    }
    await Message.findByIdAndDelete(message._id);
    const io = req.app.get('socketio');
    if (io) {
      const recipientRoom = message.receiverId.toString();
      const senderRoom = myId.toString();
      io.to(recipientRoom).emit("message-deleted", { messageId: message._id.toString() });
            io.to(senderRoom).emit("message-deleted", { messageId: message._id.toString() });
    }

    return res.json({ 
      success: true, 
      message: "Message and associated assets deleted successfully." 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 4: Forward trace logs safely through your central system firewall error interceptor
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: PATCH /api/messages/mark-read/:otherUserId
// =========================================================================
app.patch('/api/messages/mark-read/:otherUserId', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    const myId = req.user?.id || req.user?._id;
    const { otherUserId } = req.params;

    // 🛡️ SECURITY FIX 1: Strict Hex-Id Parameter Structure Validation
    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid participant identifier structure." });
    }

    const targetSenderId = new mongoose.Types.ObjectId(String(otherUserId));
    const currentReaderId = new mongoose.Types.ObjectId(String(myId));

    // Execute atomic update batch query across all unread incoming documents
    const result = await Message.updateMany(
      { 
        senderId: targetSenderId, 
        receiverId: currentReaderId, 
        status: { $ne: 'seen' } 
      },
      { 
        $set: { 
          status: 'seen', 
          seenAt: new Date() 
        } 
      }
    );

    // 🛡️ SECURITY FIX 2: Dual-Channel Real-Time Status Synchronization
    const io = req.app.get('socketio');
    if (io) {
      const senderRoom = otherUserId.toString();
      const readerRoom = myId.toString();
      
      const updatePayload = { 
        senderId: senderRoom, // The person who originally wrote the messages
        readerId: readerRoom  // The person who just read them
      };

      // A. Notify the sender's active connections to clear ticks/change bubble colors
      io.to(senderRoom).emit("messages-seen", updatePayload);
      
      // B. Notify the reader's other active browser tabs/mobile instances to clear unread badge states
      io.to(readerRoom).emit("messages-seen", updatePayload);
    }

    return res.json({ 
      success: true, 
      count: result.modifiedCount || 0
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 3: Forward exception logs safely through your central system error interceptor
    next(err);
  }
});

// ==========================================
// 📞 1. INITIATE SECURE DIAL OUT
// ==========================================
app.post('/api/calls/start', authenticateToken, async (req, res) => {
  console.log("--- 📞 CALL START INITIATED ---");
  try {
    const { receiverId, voiceId } = req.body;
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const callerId = String(req.user.id || req.user._id).trim();
    const targetId = String(receiverId).trim();
    const roomName = `room_${Date.now()}_${callerId.slice(-4)}`;
    
    await connectToDatabase();
    const CallModel = mongoose.models.Call || mongoose.model('Call');
    
    const newCall = await CallModel.create({
      roomName,
      caller: callerId,
      callerModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiver: targetId,
      receiverModel: req.user.role === 'agent' ? 'User' : 'Agent',
      status: 'calling', 
      active: true
    });

    console.log("✅ DB: Call record created strictly before response");

    const io = req.app.get('socketio');
    if (io) {
      io.to(targetId).emit("incoming-call", {
        fromId: callerId,
        fromName: req.user.firstName || "Secure Caller",
        roomName: roomName,
        callId: newCall._id,
        voiceId: voiceId || null
      });
    }

    res.status(201).json({
      success: true,
      roomName: roomName,
      callId: newCall._id 
    });

  } catch (err) {
    console.error("🔥 CRITICAL ROUTE ERROR:", err.stack);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Call failed to start" });
    }
  }
});

// ==========================================
// 🔍 2. INCOMING BACKGROUND POLLING ENGINE
// ==========================================
app.get('/api/calls/check-incoming', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const rawId = (req.user?._id || req.user?.id || req.user?.userId)?.toString();
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
    const ActiveCallModel = mongoose.models.Call || mongoose.model('Call');

    // Pull the cache reference from the Express app container
    const terminatingCallsCache = req.app.get('terminatingCallsCache');

    let incoming = await ActiveCallModel.findOne({ 
      receiver: rawId,
      status: { $in: ['calling', 'ringing'] },
      active: true,
      createdAt: { $gte: sixtySecondsAgo } 
    })
    .sort({ createdAt: -1 })
    .populate('caller', 'firstName lastName photoUrl'); 

    // Guard with cache fallback strings
    if (!incoming || (terminatingCallsCache && (terminatingCallsCache.has(incoming._id.toString()) || terminatingCallsCache.has(incoming.roomName)))) {
      return res.json({ hasIncomingCall: false });
    }
    
    let finalPhotoUrl = null;
    if (incoming.caller?.photoUrl) {
      finalPhotoUrl = await getPrivateUrl(incoming.caller.photoUrl);
    }
    if (!finalPhotoUrl) {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${incoming.caller?.firstName || 'User'}&background=0D1117&color=fff`;
    }

    return res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      status: incoming.status, 
      roomName: incoming.roomName, 
      voiceId: incoming.voiceId,
      callerData: {
        fromName: incoming.caller ? `${incoming.caller.firstName} ${incoming.caller.lastName}`.trim() : "Secure Caller",
        photoUrl: finalPhotoUrl,
        callerId: incoming.caller?._id
      }
    });
  } catch (err) {
    console.error("🔴 CRITICAL INCOMING CALL POLL ROUTE ERROR:", err.message);
    return res.status(500).json({ hasIncomingCall: false, error: err.message });
  }
});

// ==========================================
// ✅ 3. ACCEPT INCOMING AUDIO STREAM
// ==========================================
app.post('/api/calls/accept/:callId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const callId = req.params.callId || req.body.callId;
    const myId = (req.user.id || req.user._id).toString();
    const isObjectId = mongoose.Types.ObjectId.isValid(callId);
    
    const ActiveCallModel = mongoose.models.Call || mongoose.model('Call');
    const call = await ActiveCallModel.findOneAndUpdate(
      { 
        $and: [
          { $or: [{ roomName: callId }, { _id: isObjectId ? callId : null }] },
          { receiver: myId }
        ]
      }, 
      { status: 'connected', startTime: Date.now(), active: true }, 
      { new: true }
    );

    if (!call) {
      console.error(`❌ Accept failed: Call ${callId} not found for user ${myId}`);
      return res.status(404).json({ success: false, message: "Call not found." });
    }

    const roomName = call.roomName; 
    const token = await createLiveKitToken(roomName, myId);
    
    const io = req.app.get('socketio');
    if (io) {
      io.to(call.caller.toString()).emit("call-accepted", { 
        callId: call._id,
        roomName: roomName 
      });
    }

    res.json({ 
      success: true, 
      lkToken: token, 
      roomName: roomName 
    });
  } catch (err) {
    console.error("🔥 Accept Route Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ==========================================
// 📴 4. UNIFIED CALL TERMINATION LOGS
// ==========================================
app.post('/api/calls/end/:callId', authenticateToken, async (req, res) => {
  const paramCallId = req.params.callId || req.body.callId;
  
  // Pull the cache from the Express app instance
  const terminatingCallsCache = req.app.get('terminatingCallsCache');
  
  // Instantly block the tracking parameters from background pollers
  if (paramCallId && terminatingCallsCache) {
    terminatingCallsCache.add(paramCallId.toString());
  }

  try {
    await connectToDatabase();
    const myId = (req.user.id || req.user._id || req.user.userId).toString();
    const isObjectId = mongoose.Types.ObjectId.isValid(paramCallId);
    const ActiveCallModel = mongoose.models.Call || mongoose.model('Call');

    let query = {
      $and: [
        { $or: [{ roomName: paramCallId }, { _id: isObjectId ? paramCallId : null }] },
        { $or: [{ caller: myId }, { receiver: myId }] },
        { active: true } 
      ]
    };

    if (!paramCallId) {
      query = { 
        $or: [{ caller: myId }, { receiver: myId }], 
        active: true 
      };
    }

    // Capture the target context names dynamically and drop them into the shield cache
    const callToTerminate = await ActiveCallModel.findOne(query);
    if (callToTerminate && terminatingCallsCache) {
      terminatingCallsCache.add(callToTerminate._id.toString());
      terminatingCallsCache.add(callToTerminate.roomName.toString());
    }

    const call = await ActiveCallModel.findOneAndUpdate(
      query,
      { 
        status: 'ended', 
        endTime: new Date(), 
        active: false 
      },
      { new: true, sort: { createdAt: -1 } }
    );

    if (call) {
      const durationSeconds = call.startTime 
        ? Math.floor((new Date() - new Date(call.startTime)) / 1000) 
        : 0;

      const MessageModel = mongoose.models.Message || mongoose.model('Message');
      const callLogEntry = new MessageModel({
        senderId: call.caller,
        senderModel: call.callerModel,
        receiverId: call.receiver,
        receiverModel: call.receiverModel,
        fileType: 'call_log', 
        text: `Voice Call Ended (${durationSeconds}s)`, 
        callMetadata: { 
          callId: call._id, 
          roomName: call.roomName, 
          status: 'ended', 
          duration: durationSeconds 
        }
      });
      await callLogEntry.save();
      
      const io = req.app.get('socketio');
      if (io) {
        const otherId = call.caller.toString() === myId 
          ? call.receiver.toString() 
          : call.caller.toString();
        
        const payload = { callId: call._id, roomName: call.roomName };
        io.to(otherId.trim()).emit("call-ended", payload);
        io.to(otherId.trim()).emit("end-call", payload);
        io.to(call.caller.toString()).emit("new-message", callLogEntry);
        io.to(call.receiver.toString()).emit("new-message", callLogEntry);
      }

      return res.json({ success: true, message: "Call terminated", duration: durationSeconds });
    }

    res.json({ success: true, message: "No active call found" });
  } catch (err) {
    console.error("🔥 End Route Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    // Clean up cache tracking entries automatically after 5 seconds
    setTimeout(() => {
      if (paramCallId && terminatingCallsCache) {
        terminatingCallsCache.delete(paramCallId.toString());
      }
    }, 5000);
  }
});
// ==========================================
// 📊 5. FETCH STATUS TRACKING METRICS
// ==========================================
app.get('/api/calls/status/:callId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.params;
    const ActiveCallModel = mongoose.models.Call || mongoose.model('Call');
    
    let call = await ActiveCallModel.findOne({ roomName: callId }).select('status active startTime');

    if (!call && mongoose.Types.ObjectId.isValid(callId)) {
      call = await ActiveCallModel.findById(callId).select('status active startTime');
    }
    if (!call) {
      return res.json({ 
        success: true, 
        status: 'ended', 
        active: false,
        message: "Call record not found" 
      });
    }

    res.json({ 
      success: true, 
      status: call.status, 
      active: call.active,
      startTime: call.startTime 
     });

  } catch (err) {
    console.error("❌ Status Route Crash:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching status",
      debug: err.message 
    });
  }
});
// ==========================================
// 🕒 6. PORTAL CALL HISTORY ANALYTICS
// ==========================================
app.get('/api/calls/history/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const agentId = req.user.id || req.user._id;
    const ActiveCallModel = mongoose.models.Call || mongoose.model('Call');

    const calls = await ActiveCallModel.find({
      $or: [
        { caller: agentId },
        { receiver: agentId }
      ]
    })
    .sort({ createdAt: -1 }) 
    .limit(50) 
    .lean();

    const formattedCalls = await Promise.all(calls.map(async (call) => {
      const isCaller = call.caller.toString() === agentId.toString();
      let participantData;
      
      // Map across dynamic model structures securely
      if (isCaller) {
        participantData = await User.findById(call.receiver).select('firstName lastName photoUrl').lean();
      } else {
        participantData = await User.findById(call.caller).select('firstName lastName photoUrl').lean();
      }
      
      let duration = "00:00";
      if (call.startTime && call.endTime) {
        const diff = Math.floor((new Date(call.endTime) - new Date(call.startTime)) / 1000);
        const mins = Math.floor(diff / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        duration = `${mins}:${secs}`;
      }

      return {
        _id: call._id,
        type: isCaller ? 'outgoing' : 'incoming',
        participantName: participantData ? `${participantData.firstName} ${participantData.lastName}` : "Unknown User",
        participantPhoto: participantData?.photoUrl || null,
        status: call.status,
        duration: duration,
        createdAt: call.createdAt
      };
    }));

    res.json({ success: true, calls: formattedCalls });
  } catch (err) {
    console.error("Error fetching call history:", err);
    res.status(500).json({ success: false, message: "Error fetching history" });
  }
});


app.get('/api/portal/dashboard', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    // Get the agent data
    const agent = await Agent.findById(req.user.id).select('-password').lean();
    
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    // Generate a signed URL for the Agent's own profile photo
    if (agent.photoUrl && !agent.photoUrl.startsWith('http')) {
      agent.photoUrl = await getPrivateUrl(agent.photoUrl);
    }

    res.json({ agent });
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({ message: "Error fetching dashboard" });
  }
});
app.post('/api/agents/unlock-voice-package', async (req, res) => {
  const { transactionId, voiceId, duration } = req.body;

  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const response = await flw.Transaction.verify({ id: transactionId });

    if (response.data.status === "successful") {
            let daysToAdd = 30;
      if (duration === '6 Months Identity') daysToAdd = 180;
      if (duration === '1 Year Identity') daysToAdd = 365;

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysToAdd);

      // 3. Update Agent Document
      const updatedAgent = await Agent.findByIdAndUpdate(
        req.user.id,
        {
          $addToSet: { 
            unlockedVoiceIds: voiceId 
          },
          $set: {
            // We still set these so the UI knows which one was JUST activated
            voiceId: voiceId,
            voicePackageLastPaid: new Date(),
            lastTransactionId: transactionId 
          },
        },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        message: "Voice identity unlocked successfully!",
        agent: updatedAgent
      });
    } else {
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }
  } catch (error) {
    console.error("Voice Unlock Error:", error);
    res.status(500).json({ success: false, message: "Server error during voice activation." });
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/admin/register
// =========================================================================
// CRITICAL FIX: Locked behind identity validation middleware so only an existing superadmin can register new admins
app.post('/api/admin/register', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    await connectToDatabase(); 

    const { firstName, lastName, email, password, role } = req.body;
    
    // 🛡️ SECURITY FIX 1: Strict Input Cleanliness & Content Validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "All account verification fields are required." });
    }

    const lowerEmail = String(email).toLowerCase().trim();
    
    // Validate email structural string syntax regex format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lowerEmail)) {
      return res.status(400).json({ success: false, message: "Malformed or invalid email address format syntax." });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: "Password length signature must be at least 8 characters." });
    }

    // Check for duplicate entity registration matches
    const existingAdmin = await Admin.findOne({ email: lowerEmail });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Administrative profile under this email already exists." });
    }

    // Enforce strict role assignments; fallback to standard 'admin' to prevent rogue privilege elevation
    const targetRole = ['superadmin', 'admin'].includes(role) ? role : 'admin';

    const newAdmin = new Admin({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: lowerEmail, 
      password: password, // Pre-save hooks inside AdminSchema handles hashing securely
      role: targetRole 
    });

    await newAdmin.save();

    return res.status(201).json({ 
      success: true, 
      message: `Administrator profile (${targetRole}) generated and initialized successfully.` 
    });

  } catch (err) {
    // 🛡️ SECURITY FIX 2: Safely route out server trace failures into your central error handler
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/admin/login
// =========================================================================
app.post('/api/admin/login', async (req, res, next) => {
  try {
    await connectToDatabase(); 
    
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required credentials." });
    }

    const lowerEmail = String(email).toLowerCase().trim();
    const admin = await Admin.findOne({ email: lowerEmail });
    
    // 🛡️ SECURITY FIX 3: Timed Verification Gate (Mitigates User Enumeration Profiles)
    // Avoid providing granular hints like "Email not found" vs "Wrong password"
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid administrator credentials provided." 
      });
    }

    // Issue administrative session authorization token
    const token = jwt.sign(
      { 
        id: admin._id, 
        role: admin.role || 'admin' 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return mapped explicit presentation structures
    return res.status(200).json({ 
      success: true, 
      token, 
      admin: { 
        id: admin._id,
        firstName: admin.firstName || "", 
        lastName: admin.lastName || "",
        role: admin.role || "admin"
      } 
    });

  } catch (err) {
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: GET /api/admin/stats
// =========================================================================
// Use your isAdmin middleware to lock out non-administrative users
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase();

    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 🛡️ SECURITY FIX: Use a single $facet aggregation to process all stats in ONE pass
    // This reduces database CPU load significantly
    const stats = await Agent.aggregate([
      {
        $facet: {
          "totals": [{ $count: "count" }],
          "pending": [{ $match: { isVerified: false } }, { $count: "count" }],
          "revenue": [
            { $match: { isSubscribed: true, subscriptionDate: { $ne: null } } },
            {
              $group: {
                _id: null,
                daily: { $sum: { $cond: [{ $gte: ["$subscriptionDate", startOfDay] }, "$paymentDetails.amountNgn", 0] } },
                weekly: { $sum: { $cond: [{ $gte: ["$subscriptionDate", startOfWeek] }, "$paymentDetails.amountNgn", 0] } },
                monthly: { $sum: { $cond: [{ $gte: ["$subscriptionDate", startOfMonth] }, "$paymentDetails.amountNgn", 0] } },
                yearly: { $sum: { $cond: [{ $gte: ["$subscriptionDate", startOfYear] }, "$paymentDetails.amountNgn", 0] } }
              }
            }
          ],
          "chart": [
            { $match: { isSubscribed: true, subscriptionDate: { $gte: sevenDaysAgo } } },
            { $group: { _id: { $dayOfWeek: "$subscriptionDate" }, revenue: { $sum: "$paymentDetails.amountNgn" } } },
            { $sort: { "_id": 1 } }
          ]
        }
      }
    ]);

    const data = stats[0];
    
    // Formatting the chartData for the frontend
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const chartData = days.map((name, idx) => ({
      name,
      revenue: data.chart.find(c => c._id === idx + 1)?.revenue || 0
    }));

    return res.json({
      success: true,
      totalAgents: data.totals[0]?.count || 0,
      pendingAgents: data.pending[0]?.count || 0,
      currency: "NGN",
      currencySymbol: "₦",
      revenue: {
        daily: data.revenue[0]?.daily || 0,
        weekly: data.revenue[0]?.weekly || 0,
        monthly: data.revenue[0]?.monthly || 0,
        yearly: data.revenue[0]?.yearly || 0
      },
      chartData
    });

  } catch (err) {
    // 🛡️ SECURITY FIX: Hide database errors from public clients
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: GET /api/admin/agents
// =========================================================================
app.get('/api/admin/agents', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    // Select only the minimal fields needed for the Admin Table view
    const agents = await Agent.find({})
      .select('firstName lastName email program isVerified photoUrl createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const formattedAgents = agents.map(agent => ({
      _id: agent._id,
      firstName: agent.firstName || "N/A",
      lastName: agent.lastName || "",
      email: agent.email || "No Email",
      program: agent.program || "General",
      isVerified: !!agent.isVerified,
      photoUrl: agent.photoUrl || `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}`
    }));

    return res.json({ success: true, agents: formattedAgents });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: GET /api/admin/agents/:id
// =========================================================================
app.get('/api/admin/agents/:id', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid agent identifier." });
    }

    const agent = await Agent.findById(id).lean();
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent record not found." });
    }

    // 🛡️ SECURITY FIX: Resolve photo URL
    let finalPhotoUrl = agent.photoUrl;
    if (agent.photoUrl?.includes('idrivee2.com')) {
      finalPhotoUrl = await getPrivateUrl(agent.photoUrl); // Reusing your helper
    } else {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    const now = new Date();
    const isOnline = (now - new Date(agent.lastActive || agent.createdAt)) < 120000;

    // 🛡️ SECURITY FIX: Explicit Data Transfer Object (DTO)
    // We purposefully omit 'paymentDetails' or sensitive fields here.
    // If you need financial details, create a separate protected endpoint.
    return res.json({
      success: true,
      agent: {
        id: agent._id,
        email: agent.email,
        firstName: agent.firstName || "",
        lastName: agent.lastName || "",
        occupation: agent.occupation || "",
        program: agent.program || "General",
        bio: agent.bio || "",
        photoUrl: finalPhotoUrl,
        isVerified: !!agent.isVerified,
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed,
        status: isOnline ? 'online' : 'offline',
        createdAt: agent.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/support/send
// =========================================================================
app.post('/api/support/send', async (req, res, next) => {
  try {
    await connectToDatabase(); 
    const { guestId, text } = req.body;

    // 🛡️ SECURITY FIX 1: Sanitize input
    if (!guestId || !text || String(text).trim().length === 0) {
      return res.status(400).json({ success: false, message: "Invalid payload." });
    }

    const savedMsg = await SupportMessage.create({
      guestId: String(guestId).trim(),
      text: String(text).trim(),
      senderType: 'Guest',
      isAdminRead: false
    });

    const socketIo = req.app.get('socketio');
    if (socketIo) {
      // 🛡️ SECURITY FIX: Emit to a specific admin room if possible
      socketIo.to('admin_room').emit("admin_receive_support_message", {
        _id: savedMsg._id,
        guestId: savedMsg.guestId,
        text: savedMsg.text,
        isAdmin: false,
        timestamp: savedMsg.createdAt
      });
    }

    return res.status(200).json({ success: true, message: "Message Stored" });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: Admin Guest List
// =========================================================================
app.get('/api/admin/support/guests', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase();
    // Using aggregation to get the most recent contact per guest
    const guests = await SupportMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: {
          _id: "$guestId",
          lastMessage: { $first: "$text" },
          createdAt: { $first: "$createdAt" }
      }},
      { $sort: { createdAt: -1 } }
    ]);
    return res.json({ success: true, guests });
  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: Get Messages for specific Guest (Admin Only)
// =========================================================================
app.get('/api/admin/support/messages/:guestId', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { guestId } = req.params;

    // 🛡️ SECURITY FIX 2: Prevent potential NoSQL injection or junk queries
    if (!guestId || guestId.length > 50) {
      return res.status(400).json({ success: false, message: "Invalid guest identifier." });
    }

    const messages = await SupportMessage.find({ guestId: String(guestId) })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ 
      success: true, 
      messages: messages.map(msg => ({
        _id: msg._id,
        text: msg.text,
        isAdmin: msg.senderType === 'Admin',
        timestamp: msg.createdAt // Send raw Date, let the frontend format it
      }))
    });
  } catch (err) {
    next(err);
  }
});
// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/admin/broadcast-news
// =========================================================================
app.post('/api/admin/broadcast-news', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase();
    const { target, emails, subject, message, category = 'news' } = req.body;

    // 1. Resolve Recipient Data
    const query = target === 'all' ? {} : { email: { $in: emails } };
    const recipients = await Agent.find(query, 'email slug').lean();

    if (!recipients.length) {
      return res.status(404).json({ success: false, message: "No recipients found." });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const baseUrl = "https://zingconnect.vercel.app";
    const logoUrl = `${baseUrl}/logos.png`;
    const configs = {
      maintenance: { color: "#f59e0b", label: "SYSTEM MAINTENANCE", bg: "#fffbeb", icon: "⚙️" },
      subscription: { color: "#10b981", label: "SUBSCRIPTION UPDATE", bg: "#ecfdf5", icon: "💳" },
      news: { color: "#2563eb", label: "GENERAL ANNOUNCEMENT", bg: "#eff6ff", icon: "📢" }
    };

    const design = configs[category] || configs.news;

    // 🛡️ SECURITY FIX: Chunked Dispatcher
    // We process emails in groups of 10 to protect SMTP connection stability
    const CHUNK_SIZE = 10;
    
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      
      await Promise.all(chunk.map(agent => {
        const agentSlugLink = agent.slug ? `${baseUrl}/agent/${agent.slug}` : `${baseUrl}/agent/login`;

        return transporter.sendMail({
          from: `"ZingConnect Terminal" <${process.env.EMAIL_USER}>`,
          to: agent.email,
          subject: `[${design.label}] ${subject}`,
          html: `
            <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
              <div style="background-color: ${design.color}; height: 6px;"></div>
              <div style="padding: 30px; background-color: #0f172a; text-align: center;">
                <img src="${logoUrl}" alt="ZingConnect" width="140" style="margin-bottom: 15px;">
                <div style="color: ${design.color}; font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;">
                  ${design.icon} ${design.label}
                </div>
              </div>
              <div style="padding: 40px 35px;">
                <h2 style="color: #1e293b; font-size: 22px; font-weight: 700; margin: 0 0 20px 0; line-height: 1.3;">
                  ${subject}
                </h2>
                <div style="background-color: ${design.bg}; border-left: 4px solid ${design.color}; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                  <p style="color: #334155; line-height: 1.7; font-size: 15px; margin: 0; white-space: pre-wrap;">${message}</p>
                </div>
                <div style="text-align: center;">
                  <a href="${agentSlugLink}" 
                     style="background-color: #0f172a; color: white; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                     View Your Agent Profile
                  </a>
                </div>
              </div>
              <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="color: #64748b; font-size: 12px; margin: 0 0 8px 0;">This is an automated operational message for verified agents.</p>
                <p style="color: #94a3b8; font-size: 11px; margin: 0;">&copy; 2026 ZingConnect Infrastructure Team.</p>
              </div>
            </div>
          `
        });
      }));

      // Throttle delay between chunks to avoid SMTP server throttling
      if (recipients.length > CHUNK_SIZE) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return res.json({ success: true, message: `Broadcast successfully dispatched to ${recipients.length} agents.` });

  } catch (err) {
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: POST /api/admin/support/reply
// =========================================================================
app.post('/api/admin/support/reply', authenticateToken, isAdmin, async (req, res, next) => {
  try {
    await connectToDatabase(); 
    const { guestId, text } = req.body;

    if (!guestId || !text) {
      return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    const savedMsg = await SupportMessage.create({
      guestId: String(guestId).trim(),
      text: String(text).trim(),
      senderType: 'Admin', 
      isAdminRead: true
    });

    const socketIo = req.app.get('socketio');
    if (socketIo) {
      socketIo.to(String(guestId)).emit("guest_receive_admin_message", {
        _id: savedMsg._id,
        text: savedMsg.text,
        isAdmin: true,
        timestamp: savedMsg.createdAt
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Admin reply stored and emitted."
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await connectToDatabase();
    return res.status(200).json({ 
      success: true, 
      status: "Online", 
      database: "Connected" 
    });
  } catch (err) {
    console.error("Health Check Failure:", err.message); // Keep technical error in private logs
    return res.status(500).json({ 
      success: false, 
      status: "Degraded", 
      message: "Database connection failed." // Give the hacker a clean, dead-end string
    });
  }
});

// 1. Database Connection Timeout Fallback Middleware
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/socket.io')) {
    return next();
  }

  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error("CRITICAL MIDDLEWARE DB TIMEOUT:", error.message);
    return res.status(503).json({ 
      success: false, 
      message: "Database connection temporarily unavailable. Request aborted safely." 
    });
  }
});

// 2. Centralized Error Interceptor (THE LAST ACTIVE LINE OF EXPRESS CODE)
app.use((err, req, res, next) => {
  console.error("🔴 Protected Application Fault:", err.stack);

  res.status(err.status || 500).json({
    success: false,
    message: "An internal server error occurred safely."
  });
});

// 🚀 Server Activation Layer
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`--- LOCAL SERVER ACTIVE ON PORT ${PORT} ---`);
  });
}

// 📦 Export the finalized application instance
export default app;