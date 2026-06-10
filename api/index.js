import dotenv from 'dotenv';
dotenv.config(); 

console.log("--- ATTEMPTING TO START SERVER ---");

// 2. Standard Third-Party and Vendor Package Imports
import express from 'express';
import compression from 'compression'; 
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
import cookieParser from 'cookie-parser'; // Add this import
import { createAdapter } from '@socket.io/redis-adapter';

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 5000, // Wait 5s before failing
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
  }
});

redisClient.on('error', (err) => console.error('🔴 Redis Error:', err));
(async () => {
  try {
    await redisClient.connect();
    console.log('⚡ Connected to Redis successfully!');
  } catch (err) {
    console.error('⚠️ Redis connection failed:', err.message);
  }
})();

import { connectToDatabase } from './config/db.js';
import { getS3Client, getPrivateUrl, uploadToS3, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from './config/s3.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLiveKitToken } from './utils/livekitHelper.js';
import { sendOfflineNotification } from './utils/mailer.js';
import Agent from './models/Agent.js';
import User from './models/User.js'; 
import Message from './models/Message.js';
import Admin from './models/Admin.js';
import Call from './models/Call.js'; 
import SupportMessage from './models/Support.js';
import Transaction from './models/Transaction.js'; 

// 6. Express Routing Modules
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/message.js'; 
import callRoutes from './routes/callRoutes.js';
import adminRoutes from './routes/admin.js'; 
import { authenticateToken, isAdmin, requireSuperAdmin } from './middlewares/auth.js';

const app = express();

const corsOptions = {
  origin: [
    "https://www.zingconnect.chat", 
    "https://zingconnect.chat" // Add the non-www version too for safety
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // ADDED OPTIONS
  credentials: true, 
  allowedHeaders: [
    "Content-Type", 
    "Authorization", 
    "X-Requested-With", 
    "Accept", 
    "Origin"
  ],
  exposedHeaders: ["Set-Cookie"]
};

app.use(compression({
  level: 6, 
  threshold: 1024, 
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

app.use(cors(corsOptions));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.disable('x-powered-by');

// Create the parsers
const jsonParser = express.json({ limit: '5mb' });
const urlencodedParser = express.urlencoded({ limit: '5mb', extended: true });

app.use((req, res, next) => {
  const contentType = req.headers['content-type'];
  
  // If it's a file upload, skip the JSON/URL parser entirely
  if (contentType && contentType.includes('multipart/form-data')) {
    return next();
  }
  
  // Otherwise, run the standard parsers
  jsonParser(req, res, next);
});

// Repeat for urlencoded
app.use((req, res, next) => {
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('multipart/form-data')) {
    return next();
  }
  urlencodedParser(req, res, next);
});

// --- 4. GLOBAL ERROR HANDLER ---
// This handles REAL JSON errors for non-multipart routes
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('🔴 Bad JSON Request:', err.message);
    return res.status(400).json({ success: false, message: "Invalid JSON format." });
  }
  next(err);
});
// --- 4. DATABASE MIDDLEWARE ---
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/socket.io')) return next();
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    return res.status(503).json({ success: false, message: "Database connection temporarily unavailable." });
  }
});

const terminatingCallsCache = new Set();
app.set('terminatingCallsCache', terminatingCallsCache);

app.set('redisClient', redisClient); 


const server = http.createServer(app);
const pubClient = redisClient;
const subClient = redisClient.duplicate();
await subClient.connect();
const io = new Server(server, {
  path: '/api/socket.io',
  cors: corsOptions,
  transports: ['polling', 'websocket'],
  allowEIO3: true,
});

io.adapter(createAdapter(pubClient, subClient));

app.set('socketio', io);
app.use('/api/calls', callRoutes);
app.use('/api/messages', messageRoutes); 
app.use('/api/agents', authRoutes);
app.use('/api/admin', authenticateToken, isAdmin, adminRoutes); // Protected by default

const flw = new Flutterwave(process.env.VITE_FLW_PUBLIC_KEY, process.env.VITE_FLW_SECRET_KEY);
webpush.setVapidDetails(
  `mailto:${process.env.VITE_EMAIL}`,
  process.env.VITE_PUBLIC_KEY,
  process.env.VITE_PRIVATE_KEY
);
console.log("DEBUG: VAPID Configured for:", process.env.VITE_EMAIL);
console.log("DEBUG: Public Key defined:", !!process.env.VITE_PUBLIC_KEY);


const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, 
    fieldSize: 5 * 1024 * 1024 
  }
});

const getAgentModel = () => {
  return mongoose.models.Agent || Agent;
};

const syncBilling = (agent, amount) => {
  agent.subscriptionAmount = amount;
  if (!agent.paymentDetails) agent.paymentDetails = {};
  agent.paymentDetails.amountNgn = amount;
  agent.paymentDetails.currency = 'NGN';
};

// --- REDIS CACHE HELPERS (Defined in index.js) ---
const getCachedData = async (key) => {
  if (!redisClient?.isOpen) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`Cache Read Error [${key}]:`, err.message);
    return null;
  }
};

const setCachedData = async (key, data, ttl = 300) => {
  if (!redisClient?.isOpen) return;
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(data));
  } catch (err) {
    console.error(`Cache Write Error [${key}]:`, err.message);
  }
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
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS, // Ensure this is an APP PASSWORD
  },
});
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const isBase64 = (str) => {
  if (!str) return false;
  const base64Regex = /^[A-Za-z0-9+/_-]+={0,2}$/;
  return base64Regex.test(str);
};


app.get('/api/debug', (req, res) => {
  res.json({ status: "Express is alive!", path: req.path });
});

app.get('/api/test-routes', (req, res) => {
  const routes = app._router.stack
    .filter(r => r.route)
    .map(r => r.route.path);
  res.json({ registeredRoutes: routes });
});

// ==========================================
// 🛡️ HARDENED ENDPOINT: POST /api/agents/register-init
// ==========================================
app.post('/api/agents/register-init', upload.single('photo'), async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    const { 
      firstName, 
      lastName, 
      email, 
      password, 
      dob, 
      gender, 
      occupation, 
      address, 
      bio, 
      program, 
      plan 
    } = req.body;

    // 1. INPUT VALIDATION
    if (!email) return res.status(400).json({ success: false, message: "Email required." });
    
    const lowerEmail = String(email).toLowerCase().trim();
    let existingAgent = await AgentModel.findOne({ email: lowerEmail });

    // 🛡️ SECURITY FIX: OTP Throttling
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
    const hashedPassword = await bcrypt.hash(password || "temp123", 10);

    if (existingAgent) {
      if (password) existingAgent.password = hashedPassword;
      
      // ✨ FIXED: Map incoming registration data variables safely into the existing document instance fallback
      Object.assign(existingAgent, { 
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
      // ✨ FIXED: Pull real values from req.body instead of passing hardcoded empty strings
      await AgentModel.create({
        firstName: (firstName || "Agent").trim(),
        lastName: (lastName || "").trim(),
        email: lowerEmail,
        password: hashedPassword,
        slug: `${(firstName || "agent").toLowerCase()}-${Date.now().toString().slice(-4)}`,
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

    // 3. EMAIL DELIVERY
    await sendVerificationEmail(lowerEmail, firstName || "Agent", otpCode);
    return res.status(200).json({ success: true, message: "Verification code sent." });

  } catch (err) {
    console.error("❌ Registration Error:", err);
    next(err); 
  }
});

// Email Template Helper
async function sendVerificationEmail(email, firstName, otpCode) {
  const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true for port 465
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS, // Ensure this is an APP PASSWORD
  },
});
  await transporter.sendMail({
    from: `"ZingConnect Security" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Your Verification Code",
    attachments: [{
      filename: 'logo.png',
      path: './public/logo.png', 
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
}

app.post('/api/agents/verify-otp', async (req, res, next) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    const { email, otp, publicKeyJwk } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const lowerEmail = email.toLowerCase().trim();
    const agent = await AgentModel.findOne({ email: lowerEmail });

    // 1. Security: Check for account lockout
    if (agent?.failedOtpAttempts >= 5) {
      return res.status(429).json({ success: false, message: "Account locked." });
    }

    // 2. Validate OTP and Expiry
    if (!agent || agent.otp !== otp || (agent.otpExpires && agent.otpExpires < Date.now())) {
      if (agent) {
        agent.failedOtpAttempts = (agent.failedOtpAttempts || 0) + 1;
        await agent.save();
      }
      return res.status(400).json({ success: false, message: "Invalid or expired code." });
    }
// 3. 🛡️ CRITICAL SECURITY GATE: Validate Cryptographic Bundle
if (
  !publicKeyJwk || 
  !publicKeyJwk.identityKey || 
  !publicKeyJwk.preKeys || 
  !Array.isArray(publicKeyJwk.preKeys) || 
  publicKeyJwk.preKeys.length === 0 ||
  // Explicitly check that no key is an empty string
  publicKeyJwk.preKeys.some(pk => !pk.publicKey || pk.publicKey.trim() === "") || 
  !publicKeyJwk.signedPreKey ||
  !publicKeyJwk.signedPreKey.publicKey || 
  publicKeyJwk.signedPreKey.publicKey.trim() === ""
) {
  console.error(`❌ Crypto validation failed: Empty or missing keys for: ${lowerEmail}`);
  return res.status(400).json({ 
    success: false, 
    message: "Cryptographic keys could not be processed. Ensure your browser is generating keys correctly." 
  });
}

    // 4. Update agent status AND assign crypto keys
    Object.assign(agent, {
      isVerified: true,
      status: 'active',
      otp: undefined,
      otpExpires: undefined,
      failedOtpAttempts: 0,
      publicKeyJwk: publicKeyJwk // Keys are confirmed valid by the gate above
    });
    
    await agent.save();
    
    // 5. Create Session Token
    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
      signed: true
    });

    return res.status(200).json({
      success: true,
      slug: agent.slug,
      message: "Your profile is live and encrypted!"
    });

  } catch (err) {
    console.error("❌ Verification Error:", err);
    next(err); 
  }
});

app.put('/api/update-crypto-key', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    // 1. Extract registrationId along with other keys
    const { registrationId, identityKey, signedPreKey, preKeys } = req.body;
    
    // 2. Validate structural integrity
    if (!preKeys || !Array.isArray(preKeys) || !registrationId) {
      return res.status(400).json({ 
        success: false, 
        message: "Key bundle requires a valid preKeys array and a registrationId." 
      });
    }

    const userId = req.user.id;
    const targetModel = req.user.role === 'agent' ? mongoose.models.Agent : mongoose.models.User;

    // 3. Update query with slice to prevent document bloat
    const updateQuery = {
      $push: { 
        "publicKeyJwk.preKeys": { 
          $each: preKeys,
          $slice: -100 // Keeps only the most recent 100 keys
        } 
      },
      $set: { 
        "publicKeyJwk.identityKey": identityKey,
        "publicKeyJwk.signedPreKey": signedPreKey,
        "publicKeyJwk.registrationId": registrationId // Persist the ID
      }
    };

    const updatedProfile = await targetModel.findByIdAndUpdate(
      userId,
      updateQuery,
      { new: true }
    );

    if (!updatedProfile) {
      return res.status(404).json({ success: false, message: "Profile not found." });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Key bundle updated successfully." 
    });

  } catch (err) {
    next(err);
  }
});
app.get('/api/crypto/bundle/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const modelName = req.query.model === 'Agent' ? 'Agent' : 'User';
    const TargetModel = mongoose.model(modelName);

    // 1. Fetch the document
    const user = await TargetModel.findById(userId, { publicKeyJwk: 1 });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // 🛡️ CRITICAL GATE: Use the Virtual check we defined in the schema
    // This ensures we only allow sessions for users who have fully completed registration/verification
    if (!user.isCryptoReady) {
      return res.status(403).json({ 
        success: false, 
        message: "Agent is not yet cryptographically initialized." 
      });
    }

    // 2. Atomically consume one preKey
    // Note: We use findOneAndUpdate to ensure the pop happens safely in a high-concurrency environment
    const updatedUser = await TargetModel.findOneAndUpdate(
      { _id: userId, "publicKeyJwk.preKeys.0": { $exists: true } },
      { $pop: { "publicKeyJwk.preKeys": -1 } },
      { new: true, projection: { publicKeyJwk: 1 } }
    );

    // 3. Return the bundle
    // If updatedUser is null, it means no preKeys were left; return current identity bundle
    const bundleToReturn = updatedUser ? updatedUser.publicKeyJwk : user.publicKeyJwk;

    return res.status(200).json({ 
      success: true, 
      bundle: bundleToReturn 
    });

  } catch (err) {
    console.error("❌ Key fetch failed:", err);
    res.status(500).json({ success: false, message: "Key fetch failed." });
  }
});

app.post('/api/agents/login', async (req, res, next) => {
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
    }).select('slug currentSessionId firstName lastName email occupation bio isSubscribed +password'); 
    
    if (!agent || !(await bcrypt.compare(password, agent.password))) {
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
      isSubscribed: !!agent.isSubscribed
    };
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(cacheableAgent));

    const token = jwt.sign(
      { 
        id: agent._id, 
        slug: agent.slug, 
        role: 'agent',
        sessionId: newSessionId
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } 
    );
res.cookie('token', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
  signed: true // <--- Add this
});
    // Successfully logged in; token is now in the HttpOnly cookie
    return res.json({ 
      success: true, 
      slug: agent.slug 
    });

  } catch (err) {
    next(err);
  }
});

// ==========================================
// 🛡️ HARDENED ROUTE 1: GET /api/agents/profile (Redis Cached)
// ==========================================
app.get('/api/agents/profile', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const cacheKey = `agent:profile:${req.user.id}`;

  try {
    // 1. ATTEMPT CACHE HIT (Instant response)
    const cachedProfile = await redisClient.get(cacheKey);
    if (cachedProfile) {
      return res.status(200).json({ success: true, agent: JSON.parse(cachedProfile), cached: true });
    }

    // 2. DATABASE FALLBACK (Cache Miss)
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    const agent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { $set: { lastActive: new Date() } },
      { new: true } 
    ).select('firstName lastName email occupation bio photoUrl slug plan isSubscribed expiryDate voiceId voicePackageActive lastActive');

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // Logic for expiry check
    let mutationNeeded = false;
    if (agent.isSubscribed && agent.expiryDate && new Date() > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      mutationNeeded = true;
    }
    if (mutationNeeded) await agent.save();

    const presentationAgent = {
      id: agent._id,
      firstName: agent.firstName,
      lastName: agent.lastName,
      email: agent.email,
      occupation: agent.occupation,
      bio: agent.bio,
      slug: agent.slug,
      isSubscribed: !!agent.isSubscribed
    };

    // 3. SET CACHE (Expire after 1 hour / 3600 seconds)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(presentationAgent));

    return res.status(200).json({ success: true, agent: presentationAgent });

  } catch (err) {
    next(err);
  }
});

// ==========================================
// 🛡️ HARDENED ROUTE 2: GET /api/agents/profile/me (Redis Cached)
// ==========================================
app.get('/api/agents/profile/me', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const cacheKey = `agent:profile:full:${req.user.id}`;

  const forceFresh = req.query.fresh === 'true';

  try {
    // 1. Only attempt cache hit if NOT forcing refresh
    if (!forceFresh) {
      const cachedProfile = await redisClient.get(cacheKey);
      if (cachedProfile) {
        return res.status(200).json({ success: true, agent: JSON.parse(cachedProfile) });
      }
    }

    // 2. FALLBACK TO DATABASE
    await connectToDatabase();
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Invalid session" });
    }

    const AgentModel = getAgentModel();
    const agent = await AgentModel.findById(req.user.id)
      .select('+currentSessionId +expiryDate +voicePackageExpiry email firstName lastName occupation program bio address photoUrl slug plan isSubscribed subscriptionAmount subscriptionDate paymentDetails voiceId voicePackageActive publicKeyJwk lastActive createdAt');

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // 3. Dual Login Security Check
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
      }
    }

    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // 4. PREPARE RESPONSE OBJECT
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
      publicKeyJwk: agent.publicKeyJwk || null, // ADD THIS
      status: isOnline ? 'online' : 'offline',
      lastActive: agent.lastActive,
      paymentDetails: {
        amountNgn: agent.paymentDetails?.amountNgn || agent.subscriptionAmount || 0,
        currency: agent.paymentDetails?.currency || "NGN"
      }
    };

    // 5. SET CACHE (3600 seconds = 1 hour)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(responseData));

    return res.status(200).json({ success: true, agent: responseData });

  } catch (err) {
    next(err);
  }
});
// ==========================================
// 🛡️ RECONFIGURED ROUTE: POST /api/agents/update-plan
// ==========================================
app.post('/api/agents/update-plan', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
    await connectToDatabase();
    const { plan } = req.body; 
    const allowedPlans = ['BASIC', 'GROWTH', 'PROFESSIONAL'];
    const sanitizedPlan = plan ? String(plan).toUpperCase().trim() : null;

    if (!sanitizedPlan || !allowedPlans.includes(sanitizedPlan)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid plan type selection parameter." 
      });
    }

    const planPricesInNGN = {
      'BASIC': 8500,          
      'GROWTH': 51000,         
      'PROFESSIONAL': 102000    
    };

    const targetPrice = planPricesInNGN[sanitizedPlan];
    const AgentModel = getAgentModel(); 

    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id,
      { 
        $set: { 
          plan: sanitizedPlan,
          subscriptionAmount: targetPrice,
          'paymentDetails.amountNgn': targetPrice,
          'paymentDetails.currency': 'NGN'
        } 
      }, 
      { new: true, select: 'plan subscriptionAmount paymentDetails' }
    );

    if (!updatedAgent) {
      return res.status(404).json({ success: false, message: "Agent account context mismatch." });
    }

    // 🚀 CACHE INVALIDATION: Force clear the profile cache
    // This ensures the next GET /api/agents/profile/me call retrieves the fresh plan info from MongoDB
    await redisClient.del(`agent:profile:full:${req.user.id}`);

    return res.json({ 
      success: true, 
      plan: updatedAgent.plan,
      subscriptionAmount: updatedAgent.subscriptionAmount
    });

  } catch (err) {
    next(err);
  }
});

app.post('/api/users/handshake', async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
    await connectToDatabase();
    // 1. Destructure userPublicKeyJwk from request
    const { email, agentSlug, userPublicKeyJwk } = req.body;
    
    if (!email || !agentSlug) {
      return res.status(400).json({ success: false, message: "Email and Agent context required" });
    }

    // 2. Find Agent
    const agent = await Agent.findOne({ slug: agentSlug.toLowerCase().trim() });
    if (!agent) return res.status(400).json({ success: false, message: "Agent not found" });
    
    // 3. User Persistence & Key Storage
    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      user = await User.create({
        email: normalizedEmail,
        connectedAgents: [agent._id],
        publicKeyJwk: userPublicKeyJwk, // Save initial bundle
        lastLogin: new Date()
      });
    } else {
      // Update User keys if provided
      if (userPublicKeyJwk) {
        user.publicKeyJwk = userPublicKeyJwk;
        await user.save();
      }
      if (!user.connectedAgents.includes(agent._id)) {
        user.connectedAgents.push(agent._id);
        await user.save();
      }
    }

    // 4. Atomic PreKey Consumption: Remove the first available preKey from Agent
    // This prevents key reuse and ensures the session handshake is valid
    if (agent.publicKeyJwk && agent.publicKeyJwk.preKeys && agent.publicKeyJwk.preKeys.length > 0) {
      const consumedKey = agent.publicKeyJwk.preKeys.shift(); // Remove the first key
      await agent.save();
      
return res.json({ 
  success: true, 
  user: { id: user._id },
  agentIdentity: {
    registrationId: agent.publicKeyJwk.registrationId,
    identityKey: agent.publicKeyJwk.identityKey,
    signedPreKey: agent.publicKeyJwk.signedPreKey,
    preKey: consumedKey // Note: Signal often expects 'preKey' (singular) for the consumed key
  }
});
    }

    // 5. Generate Session Token (Standardized)
    const token = jwt.sign({ id: user._id, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax', path: '/', signed: true });

    return res.json({ success: true, agentIdentity: agent.publicKeyJwk });

  } catch (err) {
    next(err);
  }
});

// ==========================================
// 🛡️ OPTIMIZED HEARTBEAT ROUTE (Redis Presence)
// ==========================================
app.post('/api/agents/heartbeat', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const presenceKey = `agent:online:${req.user.id}`;

  try {
    // 1. DUAL LOGIN SECURITY CHECK 
    // We keep this database-bound for security to ensure the session hasn't been revoked.
    await connectToDatabase();
    const AgentModel = getAgentModel();
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

    // 2. REDIS PRESENCE TRACKING
    // We store the status in Redis only, with a 120-second TTL.
    // If the heartbeat stops, Redis automatically expires the key.
    await redisClient.setEx(presenceKey, 120, 'online');

    // 3. RESPOND
    // We return 'online' and the current timestamp without writing to MongoDB.
    res.json({ 
      success: true, 
      lastActive: new Date(), 
      status: 'online' 
    });

  } catch (err) {
    next(err);
  }
});
// ==========================================
// 🛡️ OPTIMIZED LOGOUT ROUTE (Redis Cleanup)
// ==========================================
app.post('/api/agents/logout', async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
const token = req.signedCookies?.token;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const agentId = decoded.id;
      
      // Cleanup: Remove online presence and cached profile
      // Using pipeline is more efficient if you have multiple keys to delete
      await redisClient.del(`agent:online:${agentId}`);
      await redisClient.del(`agent:profile:full:${agentId}`);
      await redisClient.del(`agent:profile:${agentId}`); // Ensure consistency with handshake/login cache keys
    }

    // 3. Clear the cookie with identical settings used during creation
    res.clearCookie('token', {
     httpOnly: true,       // Prevents XSS/JS access
  secure: true,         // MANDATORY because your domain is HTTPS
  sameSite: 'None',     // Ensures the cookie is sent in all contexts
  path: '/'
});

    return res.json({ 
      success: true, 
      message: "Session successfully terminated." 
    });
  } catch (err) {
    // If token is invalid/expired, still attempt to clear cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/'
    });
    return res.json({ success: true, message: "Session terminated." });
  }
});

app.get('/api/users/my-session', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const userId = req.user.id || req.user._id;
  const { agentId, slug } = req.query;
  
  // Create a unique key based on the user and the requested agent context
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

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Update activity in background
    User.updateOne({ _id: userId }, { lastActive: new Date() }).catch(console.error);

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

    let isOnline = false, signedPhotoUrl = null;

    if (activeAgent) {
      // Check Redis for "Online" status (Presence Pattern)
      // This is much faster than date math on activeAgent.lastActive
      const onlineStatus = await redisClient.get(`agent:online:${activeAgent._id}`);
      isOnline = !!onlineStatus;

      signedPhotoUrl = activeAgent.photoUrl ? await getPrivateUrl(activeAgent.photoUrl) : 
                        `https://ui-avatars.com/api/?name=${activeAgent.firstName}+${activeAgent.lastName}&background=0D1117&color=fff&size=128`;
    }

    const responsePayload = {
      success: true,
      user: { 
        id: user._id, 
        email: user.email, 
        isProfileComplete: user.isProfileComplete, 
        publicKeyJwk: user.publicKeyJwk 
      },
      agent: activeAgent ? { 
        ...activeAgent.toObject(), 
        photoUrl: signedPhotoUrl, 
        status: isOnline ? 'online' : 'offline', 
        lastSeenText: isOnline ? "Online" : "Offline",
        publicKeyJwk: activeAgent.publicKeyJwk 
      } : null
    };

    // 3. SET CACHE (Set for 1 hour)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(responsePayload));

    return res.json(responsePayload);

  } catch (err) {
    console.error("CRITICAL SESSION ERROR:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ==============================================================================
// 🛡️ HARDENED ROUTE: PUT /api/users/update-user-onboarding (Corrected Mapping)
// ==============================================================================
app.put('/api/users/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  
  try {
    await connectToDatabase();
    const s3Client = getS3Client(); 

    const { firstName, lastName, dob, gender, city, state, phone } = req.body;
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({ success: false, message: "User identity not found in token" });
    }

    // 1. Process Phone Data
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

    // 2. Prepare Update Object
    const updateData = {
      firstName: firstName ? String(firstName).trim() : "",
      lastName: lastName ? String(lastName).trim() : "",
      phone: parsedPhone, 
      dob: dob || null,      // Ensure DOB is mapped
      gender: gender ? String(gender).toLowerCase().trim() : undefined,
      city: city ? String(city).trim() : "",
      state: state ? String(state).trim() : "",
      isProfileComplete: true,
      isVerified: true
    };

    // 3. Handle File Upload (Only update if a new file is present)
    if (req.file) {
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const allowedExtensions = /.(jpg|jpeg|png|webp)$/i;

      if (!allowedMimeTypes.includes(req.file.mimetype) || !allowedExtensions.test(req.file.originalname)) {
        return res.status(400).json({ 
          success: false, 
          message: "Security Violation: Unsupported file type." 
        });
      }

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
    }

    // 4. Update Database
    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      { $set: updateData }, 
      { new: true, runValidators: true }
    ).select('email firstName lastName dob gender isProfileComplete city state photoUrl phone publicKeyJwk');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User account not found" });
    }

    // 5. CACHE INVALIDATION
    if (redisClient?.isOpen) {
      const keys = await redisClient.keys(`user:session:${userId}:*`);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    }

    return res.json({ 
      success: true, 
      message: "Onboarding complete", 
      user: updatedUser 
    });

  } catch (err) {
    next(err);
  }
});

// ==========================================
// 🛡️ OPTIMIZED PUBLIC PROFILE ROUTE (Redis Cached)
// ==========================================
app.get('/api/agents/:slug', async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const cleanSlug = req.params.slug ? req.params.slug.trim() : "";
  const cacheKey = `agent:public:${cleanSlug}`;

  try {
    // 1. ATTEMPT CACHE HIT
    const cachedProfile = await redisClient.get(cacheKey);
    if (cachedProfile) {
      return res.status(200).json({ success: true, agent: JSON.parse(cachedProfile) });
    }

    // 2. INPUT VALIDATION
    if (!cleanSlug || cleanSlug.length > 60) {
      return res.status(400).json({ success: false, message: "Invalid lookup identifier syntax." });
    }

    await connectToDatabase();
    const AgentModel = getAgentModel(); 
    if (!AgentModel) {
      return res.status(500).json({ message: "Configuration Error: Agent Model not found" });
    }

    // 3. DATABASE LOOKUP
    const agent = await AgentModel.findOne({ slug: cleanSlug })
      .select('firstName lastName photoUrl occupation program bio slug')
      .lean();

    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // 4. PREPARE RESPONSE OBJECT
    let photoUrl = null;
    if (agent.photoUrl) {
      try {
        photoUrl = await getPrivateUrl(agent.photoUrl);
      } catch (err) {
        console.error("S3 signing error:", err.message);
      }
    }
    
    if (!photoUrl) {
      photoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    const agentData = {
      id: agent._id,
      firstName: agent.firstName || "",
      lastName: agent.lastName || "",
      photoUrl: photoUrl,
      occupation: agent.occupation || "",
      program: agent.program || "",
      bio: agent.bio || "",
      slug: agent.slug
    };

    // 5. SET CACHE (Set for 1 hour)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(agentData));

    return res.json({ success: true, agent: agentData });

  } catch (err) {
    next(err);
  }
});
// ==========================================
// 🛡️ HARDENED ROUTE: PUT /api/agents/update-profile (with Redis Invalidation)
// ==========================================
app.put('/api/agents/update-profile', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    const agent = await AgentModel.findById(req.user.id).select('+password +unlockedVoiceIds');
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found" });
    }

    const { 
      firstName, lastName, occupation, program, bio, address, 
      gender, dob, voiceId, voiceDisplayName, voiceSettings,
      oldPassword, newPassword 
    } = req.body;

    // Handle Password Updates...
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

    // Explicit Mutate Assignments...
    if (firstName !== undefined) agent.firstName = String(firstName).trim();
    if (lastName !== undefined) agent.lastName = String(lastName).trim();
    if (occupation !== undefined) agent.occupation = String(occupation).trim();
    if (program !== undefined) agent.program = String(program).trim();
    if (bio !== undefined) agent.bio = String(bio).trim();
    if (address !== undefined) agent.address = String(address).trim();
    if (gender !== undefined) agent.gender = String(gender).toLowerCase().trim();
    if (dob !== undefined) agent.dob = dob;

    // Voice Licensing Access Control...
    if (voiceId !== undefined) {
      if (voiceId === null) {
        agent.voiceId = null;
      } else {
        const hasLicense = agent.unlockedVoiceIds && agent.unlockedVoiceIds.includes(String(voiceId));
        if (hasLicense) {
          agent.voiceId = String(voiceId);
        } else {
          return res.status(403).json({ success: false, message: "Unauthorized: Active license required." });
        }
      }
    }

    if (voiceDisplayName !== undefined) agent.voiceDisplayName = String(voiceDisplayName).trim();
    
    if (voiceSettings && typeof voiceSettings === 'object') {
      agent.voiceSettings = { ...agent.voiceSettings, ...voiceSettings };
    }

    await agent.save();

    // 🚀 CACHE INVALIDATION:
    // 1. Invalidate Private Profile Cache (used by dashboard)
    await redisClient.del(`agent:profile:full:${req.user.id}`);
    // 2. Invalidate Public Profile Cache (used by public profile page)
    await redisClient.del(`agent:public:${agent.slug}`);

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
    next(err);
  }
});
app.get('/api/users/me', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');
  const cacheKey = `user:profile:full:${req.user.id}`;

  try {
    // 1. ATTEMPT CACHE HIT
const cachedData = await getCachedData(cacheKey);
    if (cachedData) {
      return res.status(200).json(JSON.parse(cachedData));
    }

    // 2. FALLBACK TO DATABASE
    await connectToDatabase();
    const user = await User.findById(req.user.id)
      .select('firstName lastName email phone dob gender city state photoUrl isProfileComplete connectedAgents')
      .populate({
        path: 'connectedAgents',
        select: '_id name firstName lastName slug photoUrl avatarUrl profileImage'  
      });
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Process URLs (The heavy lifting)
    let signedPhotoUrl = user.photoUrl || null;
    if (signedPhotoUrl && !signedPhotoUrl.startsWith('data:') && !signedPhotoUrl.startsWith('http')) {
      try { signedPhotoUrl = await getPrivateUrl(signedPhotoUrl); } catch (e) { console.error(e); }
    }
    if (!signedPhotoUrl) signedPhotoUrl = `https://ui-avatars.com/api/?name=${user.firstName || 'User'}+${user.lastName || ''}&background=0D1117&color=fff&size=128`;

    const userObj = user.toObject();
    if (userObj.connectedAgents?.length > 0) {
      userObj.connectedAgents = await Promise.all(userObj.connectedAgents.map(async (agent) => {
        const raw = agent.profileImage || agent.avatarUrl || agent.photoUrl || "";
        agent.photoUrl = (raw && !raw.startsWith('http') && !raw.startsWith('data:')) ? await getPrivateUrl(raw).catch(() => raw) : raw;
        return agent;
      }));
    }

    // 3. CONSTRUCT RESPONSE
    const responsePayload = { 
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
    };

    // 4. SET CACHE (Expires in 1 hour)
    await redisClient.setEx(cacheKey, 3600, JSON.stringify(responsePayload));

    return res.json(responsePayload);

  } catch (err) {
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
// 🛡️ HARDENED ROUTE: POST /api/subscriptions/verify (With Cache Invalidation)
// =========================================================================
app.post('/api/subscriptions/verify', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
    await connectToDatabase();

    // Use req.user.id populated by the authenticateToken middleware
    const agentId = req.user.id;

    const { transaction_id, plan } = req.body || {};

    if (!transaction_id || !plan) {
      return res.status(400).json({ message: "Transaction ID and target plan choice are required" });
    }

    const planPricesInNGN = {
      'BASIC': 8500,
      'GROWTH': 51000,
      'PROFESSIONAL': 102000
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
      
      const AgentModel = getAgentModel(); 
      // Using agentId from the secure session
      const agent = await AgentModel.findById(agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent profile mapping context missing." });
      }

      const now = new Date();
      let baseDate = new Date();
      let calculatedMonths = 1;

      if (agent.isSubscribed && agent.expiryDate && new Date(agent.expiryDate).getTime() > Date.now()) {
        baseDate = new Date(agent.expiryDate);
      }

      if (targetPlan === 'BASIC') {
        baseDate.setMonth(baseDate.getMonth() + 1);
        calculatedMonths = 1;
      } else if (targetPlan === 'GROWTH') {
        baseDate.setMonth(baseDate.getMonth() + 6);
        calculatedMonths = 6;
      } else if (targetPlan === 'PROFESSIONAL') {
        baseDate.setFullYear(baseDate.getFullYear() + 1);
        calculatedMonths = 12;
      }

      await Transaction.create({
        agentId: agent._id,
        transactionId: String(transaction_id),
        txRef: data.tx_ref || `ZING-VRF-${Date.now()}`,
        plan: targetPlan,
        months: calculatedMonths,
        amount: Number(data.amount),
        currency: "NGN",
        status: "successful",
        paidAt: now
      });

      const finalNumericAmount = Number(data.amount);

      agent.isSubscribed = true;
      agent.plan = targetPlan;
      agent.status = 'active';
      if (!agent.subscriptionDate) agent.subscriptionDate = now;
      agent.expiryDate = baseDate;
      agent.expiryNotificationSent = false;
      agent.lastTransactionId = String(transaction_id);
      agent.subscriptionAmount = finalNumericAmount; 
      agent.paymentDetails = {
        amountNgn: finalNumericAmount,
        currency: "NGN",
        verifiedAt: now
      };
      
      syncBilling(agent, finalNumericAmount);
      await agent.save();
// 🚀 CRITICAL: CLEAR BOTH CACHE VARIANTS
      await redisClient.del(`agent:profile:${agent._id}`);
      await redisClient.del(`agent:profile:full:${agent._id}`);

      console.log(`Subscription ACTIVATED for: ${agent.email} | Cache invalidated for both keys.`);
      return res.json({
        success: true,
        message: "Payment verified successfully. Secure node activated.",
        redirectUrl: `/agent/dashboard/${agent.slug}`, // Add this field
        agent: {
          id: agent._id,
          email: agent.email,
          plan: agent.plan,
          isSubscribed: !!agent.isSubscribed,
          expiryDate: agent.expiryDate,
          subscriptionAmount: agent.subscriptionAmount,
          paymentDetails: agent.paymentDetails
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed."
      });
    }
  } catch (err) {
    next(err);
  }
});
// =========================================================================
// 💳 EXTEND/UPGRADE SUBSCRIPTION PIPELINE (WITH CACHE INVALIDATION)
// =========================================================================
app.put('/api/agents/update-subscription', authenticateToken, async (req, res, next) => {
  const redisClient = req.app.get('redisClient');

  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    
    // Use req.user.id populated by authenticateToken
    const agentId = req.user.id; 
    const { planTier, months, transaction_id } = req.body;

    if (!planTier || !months || months < 1 || !transaction_id) {
      return res.status(400).json({ success: false, message: "Invalid parameters or missing Flutterwave transaction reference." });
    }

    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found." });
    }

    const planPricesInNGN = {
      'BASIC': 8500,          
      'GROWTH': 51000,        
      'PROFESSIONAL': 102000   
    };

    const targetPlan = planTier.toUpperCase().trim();
    const monthlyRate = planPricesInNGN[targetPlan];
    
    if (!monthlyRate) {
      return res.status(400).json({ success: false, message: "Invalid tier selection classification." });
    }

    const totalCostExpected = monthlyRate * parseInt(months, 10);

    const flwVerify = await flw.Transaction.verify({ id: transaction_id });
    const flwData = flwVerify.data;

    if (
      flwData.status !== "successful" ||
      flwData.currency !== "NGN" ||
      Number(flwData.amount) < totalCostExpected
    ) {
      return res.status(400).json({ 
        success: false, 
        message: `Payment validation failed. Expected: ₦${totalCostExpected}, Received: ₦${flwData.amount}` 
      });
    }

    let baseDate = new Date();
    const now = new Date();

    if (agent.isSubscribed && agent.expiryDate && new Date(agent.expiryDate).getTime() > now.getTime()) {
      baseDate = new Date(agent.expiryDate);
    }

    baseDate.setMonth(baseDate.getMonth() + parseInt(months, 10));
    const newExpiryDate = baseDate.toISOString();

    await Transaction.create({
      agentId: agent._id,
      transactionId: String(transaction_id),
      txRef: flwData.tx_ref || `ZING-EXT-${Date.now()}`,
      plan: targetPlan,
      months: parseInt(months, 10),
      amount: Number(flwData.amount),
      currency: "NGN",
      status: "successful",
      paidAt: now
    });

    const finalUpgradeAmount = Number(flwData.amount);

    agent.plan = targetPlan;
    agent.isSubscribed = true;
    agent.status = 'active';
    agent.subscriptionAmount = finalUpgradeAmount; 
    agent.expiryDate = newExpiryDate;
    agent.lastTransactionId = String(transaction_id);
    
    if (!agent.subscriptionDate) {
      agent.subscriptionDate = now.toISOString();
    }

    agent.paymentDetails = {
      amountNgn: finalUpgradeAmount,
      currency: "NGN",
      verifiedAt: now.toISOString()
    };
  
    syncBilling(agent, finalUpgradeAmount);
    await agent.save();

    await redisClient.del(`agent:profile:${agentId}`);

    return res.status(200).json({
      success: true,
      message: `Successfully extended ${targetPlan} subscription by ${months} month(s)!`,
      agent: {
        plan: agent.plan,
        isSubscribed: agent.isSubscribed,
        expiryDate: agent.expiryDate,
        subscriptionAmount: agent.subscriptionAmount,
        paymentDetails: agent.paymentDetails
      }
    });

  } catch (err) {
    console.error("❌ Subscription Sync Error:", err);
    next(err);
  }
});

// =========================================================================
// 📑 HISTORICAL FETCH QUERY: GET /api/agents/subscription/history
// =========================================================================
app.get('/api/agents/subscription/history', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();

    // Use req.user.id populated by authenticateToken
    const history = await Transaction.find({ agentId: req.user.id })
      .sort({ paidAt: -1 });

    return res.status(200).json({
      success: true,
      history
    });

  } catch (err) {
    console.error("❌ Transaction History Fetch Failure:", err);
    next(err);
  }
});

// =========================================================================
// 🛡️ HARDENED ENDPOINT: GET /api/agents/my-users (Fault-Tolerant Redis)
// =========================================================================
app.get('/api/agents/my-users', authenticateToken, async (req, res, next) => {
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
        if (cachedData) return res.status(200).json(cachedData);
      } catch (cacheErr) {
        console.error("Cache read error, proceeding to DB:", cacheErr.message);
      }
    }

    // 2. FALLBACK TO DATABASE
    await connectToDatabase();
    const ActiveUserModel = mongoose.models.User || User;
    
    const users = await ActiveUserModel.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl gender city state isVerified isProfileComplete lastLogin lastActive createdAt publicKeyJwk')
      .sort({ lastActive: -1 })
      .lean();

    const unreadCountsData = await Message.aggregate([
      { $match: { receiverId: new mongoose.Types.ObjectId(String(agentId)), receiverModel: 'Agent', status: { $in: ['sent', 'delivered'] } } },
      { $group: { _id: "$senderId", count: { $sum: 1 } } }
    ]);

    const unreadMap = unreadCountsData.reduce((acc, item) => {
      if (item._id) acc[item._id.toString()] = item.count;
      return acc;
    }, {});

    const nowTimestamp = Date.now();

    // 3. PROCESS USERS & SIGN URLS
    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      if (user.photoUrl && typeof user.photoUrl === 'string') {
        if (user.photoUrl.startsWith('data:') || user.photoUrl.startsWith('http')) {
          finalPhotoUrl = user.photoUrl;
        } else {
          try {
            let fileKey = user.photoUrl.includes('.com/') ? user.photoUrl.split('.com/')[1].split('?')[0] : user.photoUrl;
            finalPhotoUrl = await getPrivateUrl(fileKey.startsWith('/') ? fileKey.slice(1) : fileKey);
          } catch (s3Err) {
            console.error(`[S3 Error] Failed to sign photo for ${user._id}:`, s3Err.message);
          }
        }
      }

      if (!finalPhotoUrl) {
        const name = encodeURIComponent(`${user.firstName || 'U'} ${user.lastName || ''}`);
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
      }

      const isOnline = user.lastActive && new Date(user.lastActive) > new Date(nowTimestamp - 5 * 60 * 1000);
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

    // 4. SET CACHE (Best Effort)
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

app.post('/api/messages/send', authenticateToken, async (req, res, next) => {
  const myId = req.user.id;

  try {
    await connectToDatabase();
    let senderDoc = await Agent.findById(myId) || await User.findById(myId);
    if (!senderDoc) {
      return res.status(404).json({ success: false, message: "Sender identity not found." });
    }
    const senderRole = await Agent.exists({ _id: myId }) ? 'Agent' : 'User';
    
    const { receiverId, text, ciphertext, receiverModel, fileType, replyToId, iv, isEncrypted } = req.body;

    if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ success: false, message: "Invalid recipient identifier structure." });
    }
    const sanitizedModel = ['Agent', 'User'].includes(receiverModel) ? receiverModel : 'User';

    if (isEncrypted) {
      if (!ciphertext || !iv) {
        return res.status(400).json({ success: false, message: "Security violation: Payload/IV required." });
      }
      if (Buffer.from(iv, 'base64').length !== 12) {
        return res.status(400).json({ success: false, message: "Security violation: Invalid IV." });
      }
    } else if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, message: "Message text cannot be blank." });
    }

    const newMessage = new Message({
      senderId: myId,
      senderModel: senderRole,
      receiverId: new mongoose.Types.ObjectId(receiverId),
      receiverModel: sanitizedModel,
      text: isEncrypted ? null : String(text).trim(), 
      payload: isEncrypted ? payload : null, 
      isEncrypted: !!isEncrypted,
      fileType: fileType || 'text',
      replyToId: (replyToId && mongoose.Types.ObjectId.isValid(replyToId)) ? new mongoose.Types.ObjectId(replyToId) : null,
      notificationSent: false
    });
    
    await newMessage.save();

    const TargetModel = sanitizedModel === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId)
      .select('pushSubscription lastNotificationEmail email firstName lastName');
    
    if (!receiver) {
      return res.status(404).json({ success: false, message: "Recipient entity match not found." });
    }

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(receiverId.toString()).emit("RECEIVE_PRIVATE_MESSAGE", newMessage);
      }
    } catch (socketErr) {
      console.error("⚠️ Socket emission warning:", socketErr.message);
    }

    // 6. Notifications Logic
    const baseUrl = "https://www.zingconnect.chat";
    const path = sanitizedModel === 'Agent' ? `/agent/dashboard?userId=${myId}` : `/user/dashboard?agentId=${myId}`;
    const senderName = senderDoc.firstName || senderDoc.email?.split('@')[0] || 'ZingConnect';
    
    const notificationBody = newMessage.isEncrypted 
      ? "🔒 Sent an end-to-end encrypted message" 
      : (text?.length > 40 ? `${text.substring(0, 40)}...` : text);

    if (receiver.pushSubscription?.endpoint) {
      try {
        await webpush.sendNotification(receiver.pushSubscription, JSON.stringify({
          title: `New Message from ${senderName}`,
          body: notificationBody,
          icon: `${baseUrl}/logo-s.png`,
          data: { url: `${baseUrl}${path}`, type: 'message' }
        }));
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
      } catch (pushErr) {
        console.error("❌ PUSH FAILED:", pushErr.message);
      }
    }

    try {
      const COOLDOWN = 30 * 60 * 1000;
      const lastEmailTime = receiver.lastNotificationEmail?.getTime() || 0;
      if (Date.now() - lastEmailTime > COOLDOWN) {
        await sendOfflineNotification(receiver, senderDoc, newMessage.isEncrypted ? "Please login to view." : text, sanitizedModel);
        await TargetModel.findByIdAndUpdate(receiverId, { $set: { lastNotificationEmail: new Date() } });
      }
    } catch (mailErr) {
      console.error("❌ Email Error:", mailErr.message);
    }
const savedMsg = newMessage.toObject();
    const responseMsg = {
      ...savedMsg,
      id: savedMsg._id,
      sender: { id: myId },
      payload: savedMsg.payload, 
      isEncrypted: savedMsg.isEncrypted
    };
    
    return res.status(201).json({ success: true, message: responseMsg });

  } catch (err) {
    next(err);
  }
});
app.get('/api/messages/:otherUserId', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ success: false, message: "Invalid chat target identifier." });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate({ path: 'senderId', select: 'firstName lastName photoUrl slug', refPath: 'senderModel' })
    .populate({ path: 'receiverId', select: 'firstName lastName photoUrl slug', refPath: 'receiverModel' })
    .lean();

    const chronologicalMessages = messages.reverse();

    const processedMessages = await Promise.all(chronologicalMessages.map(async (m) => {
      // 1. DTO Construction
      const msgDto = {
        _id: m._id,
        id: m._id,
        senderId: m.senderId?._id || m.senderId,
        senderModel: m.senderModel || 'User',
        receiverId: m.receiverId?._id || m.receiverId,
        receiverModel: m.receiverModel || 'User',
        // E2EE Data: Always pass payload as-is for the SignalEngine to process
        isEncrypted: !!m.isEncrypted,
        payload: m.payload || null, 
        text: m.text || "",
        fileType: m.fileType || 'text',
        createdAt: m.createdAt,
        fileUrl: null,
        sender: {
            firstName: m.senderId?.firstName || "Unknown",
            photoUrl: m.senderId?.photoUrl || ""
        }
      };

      // 2. Handle Secure S3 Media URLs
      if (m.fileUrl) {
        try {
          let fileKey = m.fileUrl;
          if (fileKey.startsWith('http')) {
            const urlParts = fileKey.split('idrivee2.com/');
            if (urlParts.length > 1) fileKey = urlParts[1].split('/').slice(1).join('/');
          }
          msgDto.fileUrl = await getPrivateUrl(fileKey);
        } catch (s3Err) {
          console.error(`[S3 Chat Error] ${m._id}:`, s3Err.message);
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
// 🛡️ HARDENED ROUTE: POST /api/save-subscription (DEEP DE-SERIALIZATION)
// =========================================================================
app.post('/api/save-subscription', authenticateToken, async (req, res, next) => {
  try {
    await connectToDatabase();
    
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Identity context not found." });
    }

    let sub = req.body.subscription || req.body;
    if (!sub) {
      return res.status(400).json({ success: false, message: "No subscription payload provided." });
    }

    // Dynamic Deep-Extraction Check handles both pure JSON strings or raw payload formats safely
    let targetKeys = sub.keys;
    if (!targetKeys && sub.toJSON) {
      targetKeys = sub.toJSON().keys;
    }

    // Structural recovery if nested inside parent strings
    const endpoint = sub.endpoint;
    const p256dh = targetKeys?.p256dh;
    const auth = targetKeys?.auth;

    if (!endpoint || !p256dh || !auth) {
      console.error("DEBUG: Incomplete push payload received:", { 
        endpoint: !!endpoint, 
        hasKeys: !!targetKeys,
        p256dh: !!p256dh,
        auth: !!auth
      });
      return res.status(400).json({ 
        success: false, 
        message: "Incomplete push payload: Missing endpoint or encryption keys." 
      });
    }

    const sanitizedSubscription = {
      endpoint: String(endpoint).trim(),
      expirationTime: sub.expirationTime || null,
      keys: {
        p256dh: String(p256dh).trim(),
        auth: String(auth).trim()
      }
    };

    // Fallback support checking token roles explicitly to split your collections 
    const TargetModelName = req.user.role === 'agent' ? 'Agent' : 'User';
    const TargetModel = mongoose.models[TargetModelName] || mongoose.model(TargetModelName);

    const updated = await TargetModel.findByIdAndUpdate(
  userId,
  { $set: { pushSubscription: sanitizedSubscription } },
  { returnDocument: 'after', runValidators: true } 
);

    if (!updated) {
      return res.status(404).json({ success: false, message: "Profile matching token credentials not found." });
    }

    console.log(`✅ Push credentials synchronized for target [${TargetModelName}]: ${userId}`);
    return res.json({ success: true, message: "Push credentials synchronized." });

  } catch (err) {
    console.error("❌ Error saving subscription:", err);
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

    // 🚀 Distributed Socket lookup using Redis adapter fetch methods
    const io = req.app.get('socketio');
    let isOnline = false;
    if (io) {
      const sockets = await io.in(receiverId.toString()).fetchSockets();
      isOnline = sockets.length > 0;
    }

    // Web Push Notification Routing Logic
    const baseUrl = "https://www.zingconnect.chat";
    const path = receiverModel === 'Agent' ? `/agent/dashboard?userId=${req.user.id}` : `/user/dashboard?agentId=${req.user.id}`;
    const senderName = sender?.firstName || sender?.email?.split('@')[0] || 'Zing';
    
    const notificationBody = text?.trim() 
      ? (text.length > 60 ? `${text.substring(0, 60)}...` : text) 
      : (detectedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo");

    const payload = JSON.stringify({
      title: `New Message from ${senderName}`,
      body: notificationBody,
      icon: `${baseUrl}/logo-s.png`,
      badge: `${baseUrl}/logo-s.png`,
      data: { url: `${baseUrl}${path}`, type: 'message' }
    });

    // ====== TEMPORARY PUSH DIAGNOSTIC LOGS ======
    console.log("---------------- UPLOAD PUSH DIAGNOSTIC ----------------");
    console.log("Recipient ID:", receiverId);
    console.log("Recipient Role:", receiverModel);
    console.log("Recipient Found in DB:", !!receiver);
    console.log("Has pushSubscription Field:", !!receiver?.pushSubscription);
    console.log("Target Push Endpoint:", receiver?.pushSubscription?.endpoint || "❌ MISSING/UNDEFINED");
    console.log("---------------------------------------------------------");

    if (receiver && receiver.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
        console.log(`✅ Push notification sent for media upload to ${receiverId}`);
      } catch (pushErr) {
        console.error("❌ MEDIA PUSH FAILED:", pushErr.message);
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          const TargetModel = receiverModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
          await TargetModel.findByIdAndUpdate(receiverId, { $unset: { pushSubscription: "" } });
          if (redis) await redis.del(`profile:${receiverId}`).catch(() => {});
          console.log(`🧹 Cleared dead subscription for ${receiverId}`);
        }
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
          if (redis) {
            await redis.del(`profile:${receiverId}`).catch(() => {});
          }

          await sendOfflineNotification(receiver, sender, text || "", fileName, detectedType, receiverModel);
          console.log(`📧 Offline media email notification sent to ${receiver.email}`);
        }
      } catch (mailErr) {
        console.error("❌ Email Throttle Error:", mailErr.message);
      }
    }

    if (isOnline && io) {
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

    // 🚀 Distributed Socket Lookup via Redis Adapter Cluster Polling
    const io = req.app.get('socketio');
    let isOnline = false;
    if (io) {
      const sockets = await io.in(receiverId.toString()).fetchSockets();
      isOnline = sockets.length > 0;
    }

    // Web Push Notification Routing Logic
    const baseUrl = "https://www.zingconnect.chat";
    const path = receiverModel === 'Agent' ? `/agent/dashboard?userId=${req.user.id}` : `/user/dashboard?agentId=${req.user.id}`;
    const senderName = sender?.firstName || sender?.email?.split('@')[0] || 'Zing';
    
    const notificationBody = text?.trim() 
      ? (text.length > 60 ? `${text.substring(0, 60)}...` : text) 
      : (sanitizedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo");

    const payload = JSON.stringify({
      title: `New Message from ${senderName}`,
      body: notificationBody,
      icon: `${baseUrl}/logo-s.png`,
      badge: `${baseUrl}/logo-s.png`,
      data: { url: `${baseUrl}${path}`, type: 'message' }
    });

    // ====== TEMPORARY PUSH DIAGNOSTIC LOGS ======
    console.log("---------------- CONFIRM PUSH DIAGNOSTIC ----------------");
    console.log("Recipient ID:", receiverId);
    console.log("Recipient Role:", receiverModel);
    console.log("Recipient Found in DB:", !!receiver);
    console.log("Has pushSubscription Field:", !!receiver?.pushSubscription);
    console.log("Target Push Endpoint:", receiver?.pushSubscription?.endpoint || "❌ MISSING/UNDEFINED");
    console.log("---------------------------------------------------------");

    if (receiver && receiver.pushSubscription && receiver.pushSubscription.endpoint) {
      try {
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { $set: { notificationSent: true } });
        console.log(`✅ Push notification sent for confirmed upload to ${receiverId}`);
      } catch (pushErr) {
        console.error("❌ CONFIRM PUSH FAILED:", pushErr.message);
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          const TargetModel = receiverModel === 'Agent' ? getAgentModel() : (mongoose.models.User || User);
          await TargetModel.findByIdAndUpdate(receiverId, { $unset: { pushSubscription: "" } });
          if (redis) await redis.del(`profile:${receiverId}`).catch(() => {});
          console.log(`🧹 Cleared dead subscription for ${receiverId}`);
        }
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
          const emailText = text ? String(text).trim() : "";
          await sendOfflineNotification(receiver, sender, emailText, sanitizedPath, sanitizedType, receiverModel);
          console.log(`📧 Offline media confirmation email notification sent to ${receiver.email}`);
        }
      } catch (mailErr) {
        console.error("❌ Email Throttle Error:", mailErr.message);
      }
    }

    // Construct the private delivery asset for immediate payload returns
    const signedUrlForFrontend = await getPrivateUrl(sanitizedPath);

    if (isOnline && io) {
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

    const baseUrl = "https://www.zingconnect.chat";
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

app.get('/api/agents/me', authenticateToken, async (req, res) => {
  console.log("🔍 Incoming request to /api/agents/me");
  console.log("Headers:", req.headers);
  await connectToDatabase();

  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    
    if (!userId || !role) {
      return res.status(400).json({ success: false, message: "Invalid session data" });
    }
    
    let profile = null;
    
   if (role === 'agent') {
  profile = await Agent.findById(userId)
    .select('firstName lastName email slug role isSubscribed plan publicKeyJwk') // ADD publicKeyJwk
    .lean();
} else {
  profile = await User.findById(userId)
    .select('email role isProfileComplete publicKeyJwk') // ADD publicKeyJwk
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

app.use((err, req, res, next) => {
  // 1. Check if 'err' exists before logging or using it
  const errorMessage = err ? err.message : 'Unknown internal server error';
  const errorStack = err ? err.stack : 'No stack trace available';
  
  console.error("❌ Server Error:", err || 'Undefined error object');

  res.status(500).json({ 
    success: false, 
    message: errorMessage,
    // Only send the stack trace in development mode for security
    stack: process.env.NODE_ENV === 'development' ? errorStack : undefined 
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