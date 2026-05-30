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
import { getS3Client, getPrivateUrl, PutObjectCommand, GetObjectCommand } from './config/s3.js'; 
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

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access Denied" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid Token" });
    
    req.user = decoded; 
    req.user.id = decoded.id || decoded._id;

    try {
      // 1. Logic for Agents: Serverless safe check & Atomic tracking update
      if (decoded.role === 'agent') {
        const AgentModel = mongoose.models.Agent || Agent;

        const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
        if (!agent) {
          return res.status(404).json({ message: "Agent not found" });
        }
        if (agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
          return res.status(401).json({ 
            success: false, 
            message: "Session Mismatch", 
            forceLogout: true 
          });
        }
        await AgentModel.findByIdAndUpdate(req.user.id, {
          $set: { lastActive: new Date() }
        });
      }
      if (decoded.role === 'admin') {
        const AdminModel = mongoose.models.Admin || Admin;
        await AdminModel.findByIdAndUpdate(req.user.id, { 
          $set: { lastLogin: new Date() } 
        });
      }
      next();
    } catch (dbErr) {
      console.error("🔴 index.js Auth Middleware Error:", dbErr.message);
      next(); 
    }
  });
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: "Access denied: Admins only" });
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
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

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

app.post('/api/agents/register-init', upload.single('photo'), async (req, res) => {
    console.log("Registration Stage 1 (Complete Fields) started...");

    try {
        await connectToDatabase();
        const AgentModel = getAgentModel();

        const { firstName, lastName, email, password } = req.body;
        const isResend = req.body.resend === 'true' || req.body.resend === true;

        // --- 1. VALIDATION ---
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required." });
        }

        // Require password only if it's NOT a resend attempt
        if (!isResend && !password) {
            return res.status(400).json({ success: false, message: "Password is required for registration." });
        }

        const lowerEmail = email.toLowerCase().trim();

        // Check verification status
        let existingAgent = await AgentModel.findOne({ email: lowerEmail });
        if (existingAgent && existingAgent.isVerified) {
            return res.status(400).json({ 
                success: false, 
                message: "Email already registered and verified. Please login." 
            });
        }

        let hashedPassword = existingAgent ? existingAgent.password : ""; 
        if (password && password.trim() !== "") {
            const salt = await bcrypt.genSalt(10);
            hashedPassword = await bcrypt.hash(password, salt);
        }

        // --- 3. SLUG GENERATION ---
        let finalSlug = existingAgent ? existingAgent.slug : "";
        if (!existingAgent) {
            // Clean names: remove special characters, default to 'agent' if first name missing
            const cleanFirst = (firstName || "agent").trim().replace(/[^a-zA-Z0-9]/g, '');
            const cleanLast = (lastName || "").trim().replace(/[^a-zA-Z0-9]/g, '');
            const baseSlug = `${cleanFirst}${cleanLast}`.toLowerCase() || "agent";
            
            finalSlug = baseSlug;
            let counter = 1;
            while (await AgentModel.findOne({ slug: finalSlug })) {
                finalSlug = `${baseSlug}-${counter}`;
                counter++;
            }
        }
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

        console.log("S3 Upload Successful:", fileKey);
    } catch (uploadErr) {
        console.error("IDRIVE UPLOAD FAILED:", uploadErr.message);
    }
}

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

        if (existingAgent) {
            if (firstName) existingAgent.firstName = firstName.trim();
            if (lastName !== undefined) existingAgent.lastName = (lastName || "").trim();
            
            existingAgent.password = hashedPassword; 
            existingAgent.photoUrl = savedPhotoPath;
            existingAgent.otp = otpCode;
            existingAgent.otpExpires = otpExpiry;

            // Optional fields update
            const fields = ['dob', 'gender', 'occupation', 'address', 'bio', 'program', 'plan'];
            fields.forEach(field => {
                if (req.body[field]) existingAgent[field] = req.body[field];
            });
            
            await existingAgent.save();
            console.log("Record Updated:", lowerEmail);
        } else {
            // Create brand new record
            const newAgent = new AgentModel({
                firstName: (firstName || "Agent").trim(),
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
            console.log("New Record Created:", lowerEmail);
        }

        // --- 7. EMAIL DELIVERY ---
        const logoPath = path.join(process.cwd(), 'public', 'logo.png');
        const attachments = fs.existsSync(logoPath) ? [{
            filename: 'logo.png',
            path: logoPath,
            cid: 'zinglogo'
        }] : [];

        try {
            await transporter.sendMail({
                from: `"ZingConnect Security" <${process.env.EMAIL_USER}>`,
                to: lowerEmail,
                subject: "Your Verification Code",
                attachments,
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
            // Optionally return a 500 here if you want to force the user to retry
        }

        res.status(200).json({ success: true, message: "Verification code sent to your email." });

    } catch (err) {
        console.error("Detailed Registration Error:", err);
        res.status(500).json({ 
            success: false, 
            message: "Internal Server Error during registration.",
            error: err.message
        });
    }
});
// --- STAGE 2: VERIFY OTP ---
app.post('/api/agents/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  try {
    await connectToDatabase();

    // --- FIX 1: INITIALIZE THE MODEL ---
    // In your architecture, Agent needs to be retrieved from the getter
    const AgentModel = getAgentModel(); 

    if (!email || !otp) {
        return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const agent = await AgentModel.findOne({ 
      email: email.toLowerCase().trim(),
      otp: otp,
      otpExpires: { $gt: Date.now() } 
    });

    if (!agent) {
      return res.status(400).json({ 
        success: false, 
        message: "The code is invalid or has expired. Please request a new one." 
      });
    }
    agent.isVerified = true;
    agent.status = 'active';    
    agent.otp = undefined; 
    agent.otpExpires = undefined;
    
    await agent.save();

    if (!process.env.JWT_SECRET) {
        console.error("CRITICAL: JWT_SECRET is not defined in .env");
        throw new Error("Security configuration missing");
    }

    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' }, 
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
    console.error("OTP Verification Error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error during verification.",
      error: err.message // Useful for debugging, remove in production
    });
  }
});


// --- Updated Login Route ---
app.post('/api/agents/login', async (req, res) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;

    const agent = await AgentModel.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!agent || !(await bcrypt.compare(password, agent.password))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const newSessionId = crypto.randomBytes(16).toString('hex');
        agent.currentSessionId = newSessionId;
    await agent.save();

    const token = jwt.sign(
      { 
        id: agent._id, 
        slug: agent.slug, 
        role: 'agent',
        sessionId: newSessionId // 👈 Embed this in the token
      }, 
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
    res.status(500).json({ success: false, message: "Server login error" });
  }
});

app.get('/api/agents/profile', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // FIX: Define Agent using your helper function if it's not imported globally
    const AgentModel = getAgentModel(); 
    
    await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { lastActive: new Date() },
      { returnDocument: 'after' } 
    );

    let agent = await AgentModel.findById(req.user.id).select('-password'); 
    
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    // Logic for expiry check
    if (agent.isSubscribed && agent.expiryDate && new Date() > new Date(agent.expiryDate)) {
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
    
    if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: "Invalid session" });
    }

    const AgentModel = getAgentModel();
    const agent = await AgentModel.findById(req.user.id);

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
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
    }
    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
        agent.voicePackageActive = false;
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
        // Fall back gracefully instead of throwing a 500 server crash
        signedPhotoUrl = null; 
      }
    }

    // Default Avatar Fallback
    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // 4. Return Normalized Client Presentation Payload
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
    console.error("🔴 CRITICAL PROFILE ROUTE EXCEPTION:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error", 
      error: err.message 
    });
  }
});

// 3. Update Agent Plan Selection
app.post('/api/agents/update-plan', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { plan } = req.body; 

    const AgentModel = getAgentModel(); 
    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id,
      { plan: plan },
      { new: true }
    );

    if (!updatedAgent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    return res.json({ success: true, plan: updatedAgent.plan });
  } catch (err) {
    console.error("Plan update failure:", err.message);
    return res.status(500).json({ success: false, message: "Failed to update plan" });
  }
});

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

app.post('/api/agents/heartbeat', authenticateToken, async (req, res) => {
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

    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { lastActive: new Date() }, 
      { new: true, select: 'lastActive' } 
    );

    res.json({ 
      success: true, 
      lastActive: updatedAgent.lastActive,
      status: 'online' 
    });
  } catch (err) {
    console.error("Heartbeat Error:", err);
    res.status(500).json({ success: false });
  }
});

app.get('/api/users/my-session', async (req, res) => {
  try {
    await connectToDatabase();
    
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token" });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await User.findByIdAndUpdate(
      decoded.id, 
      { lastActive: new Date() },
      { returnDocument: 'after' } 
    ).populate({
      path: 'connectedAgents',
      select: 'firstName lastName photoUrl occupation program bio slug lastActive gender dob'
    });

    if (!user) return res.status(404).json({ message: "User not found" });

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
    console.error("Session Error:", err);
    res.status(500).json({ message: "Session Error", error: err.message });
  }
});
app.put('/api/users/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    await connectToDatabase();
    const s3Client = getS3Client(); 

    const { firstName, lastName, dob, gender, city, state, phone } = req.body;
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User identity not found in token" });
    }

    // --- 🛠️ NEW: PARSE AND SAFE-GUARD PHONE SUB-OBJECT ---
    let parsedPhone = { raw: "", formatted: "", countryCode: "", dialCode: "" };
    
    if (phone) {
      try {
        // If the payload arrives as a JSON string string from Form Data, parse it
        const parsed = typeof phone === 'string' ? JSON.parse(phone) : phone;
        parsedPhone = {
          raw: parsed.raw ? String(parsed.raw).trim() : "",
          formatted: parsed.formatted ? String(parsed.formatted).trim() : "",
          countryCode: parsed.countryCode ? String(parsed.countryCode).toLowerCase().trim() : "",
          dialCode: parsed.dialCode ? String(parsed.dialCode).trim() : ""
        };
      } catch (e) {
        // Fallback in case raw text was pushed instead of an object
        parsedPhone.raw = String(phone).trim();
      }
    }

    // Safety fallback parsing checks to prevent invalid schemas crashing Mongoose validation engine
    const updateData = {
      firstName: firstName ? String(firstName).trim() : "",
      lastName: lastName ? String(lastName).trim() : "",
      phone: parsedPhone, // 👈 Assigned your clean nested object parameters here
      dob,
      gender: gender && typeof gender === 'string' ? gender.toLowerCase().trim() : undefined,
      city: city ? String(city).trim() : "",
      state: state ? String(state).trim() : "",
      isProfileComplete: true,
      isVerified: true
    };

    // If an invalid key managed to crawl into data parameters, remove it completely
    if (req.body.profileImage) {
      delete req.body.profileImage;
    }

    if (req.file) {
      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${userId}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      // Executes command cleanly safely against S3/iDrive structures
      await s3Client.send(new PutObjectCommand(uploadParams));
      updateData.photoUrl = fileKey; 
      
      console.log(`[Storage] Photo uploaded for User: ${userId}`);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User account not found" });
    }

    return res.json({ 
      success: true, 
      message: "Onboarding complete", 
      user: updatedUser 
    });

  } catch (err) {
    console.error("CRITICAL ONBOARDING ERROR:", err.message);
    return res.status(500).json({ 
      success: false, 
      message: "Update failed", 
      details: err.message 
    });
  }
});
app.get('/api/agents/:slug', async (req, res) => {
  try {
    console.log("--- Profile Request Start --- for:", req.params.slug);
    
    await connectToDatabase();
    const AgentModel = getAgentModel(); 

    if (!AgentModel) {
      return res.status(500).json({ message: "Configuration Error: Agent Model not found" });
    }

const agent = await AgentModel.findOne({ 
  slug: { $regex: new RegExp(`^${req.params.slug}$`, 'i') } 
}).select('-password').lean();

    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // Apply the private URL signing if a photo exists
    if (agent.photoUrl) {
      agent.photoUrl = await getPrivateUrl(agent.photoUrl);
    }

    console.log("--- Profile Request Success ---");
    return res.json(agent);

  } catch (err) {
    console.error("CRITICAL 500 ERROR:", err.message);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error", 
      details: err.message 
    });
  }
});

// --- 6. UPDATE AGENT PROFILE & SECURITY (STABILIZED) ---
app.put('/api/agents/update-profile', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel();
    const agent = await AgentModel.findById(req.user.id).select('+password');
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent account not found" });
    }
    const { 
      firstName, lastName,  occupation,   program,  bio,  address, 
      gender, dob, voiceId,  voiceDisplayName,  voiceSettings,
      oldPassword, newPassword 
    } = req.body;
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
    agent.firstName = firstName || agent.firstName;
    agent.lastName = lastName || agent.lastName;
    agent.occupation = occupation || agent.occupation;
    agent.program = program || agent.program;
    agent.bio = bio || agent.bio;
    agent.address = address || agent.address;
    agent.gender = gender || agent.gender;
    agent.dob = dob || agent.dob;
        if (voiceId !== undefined) {
      if (voiceId === null) {
        agent.voiceId = null;
        
        if (voiceDisplayName !== undefined) {
          agent.voiceDisplayName = voiceDisplayName;
        }
      } else {
        const hasLicense = agent.unlockedVoiceIds && agent.unlockedVoiceIds.includes(String(voiceId));
        
        if (hasLicense) {
          agent.voiceId = voiceId;
          if (voiceDisplayName !== undefined) {
            agent.voiceDisplayName = voiceDisplayName;
          }
        } else {
          return res.status(403).json({ 
            success: false, 
            message: "Unauthorized: Active subscription required for this identity." 
          });
        }
      }
    }
    if (voiceDisplayName !== undefined) agent.voiceDisplayName = voiceDisplayName;
    
    if (voiceSettings !== undefined) {
      agent.voiceSettings = {
        ...agent.voiceSettings,
        ...voiceSettings
      };
    }
    await agent.save();

    console.log(`[SECURITY SYNC] Profile synchronized for: ${agent.email}`);
    const updatedData = agent.toObject();
    delete updatedData.password;
    res.json({
      success: true,
      message: "Identity, Voice, and Security synchronized successfully.",
      agent: {
        ...updatedData,
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed,
        subscriptionDate: agent.subscriptionDate || null, 
        expiryDate: agent.expiryDate || null,
        unlockedVoiceIds: agent.unlockedVoiceIds || [],
        voiceId: agent.voiceId,
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
// =========================================================================
// 1. GET PROFILE ENDPOINT (FETCHES LOGGED-IN USER & HYDRATES AGENT RELATIONSHIPS)
// =========================================================================
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // 🛠️ FIX: Added fallback fields 'profileImage' and 'avatarUrl' to the select string
    const user = await User.findById(req.user.id).populate({
      path: 'connectedAgents',
      select: 'name firstName lastName slug photoUrl profileImage avatarUrl' 
    });
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let signedPhotoUrl = null;
    if (user.photoUrl) {
      signedPhotoUrl = await getPrivateUrl(user.photoUrl);
    }
    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${user.firstName || 'User'}+${user.lastName || ''}&background=0D1117&color=fff&size=128`;
    }

    const userObj = user.toObject();

    // Sign profile images for any nested connected agents if applicable
    if (userObj.connectedAgents && userObj.connectedAgents.length > 0) {
      userObj.connectedAgents = await Promise.all(
        userObj.connectedAgents.map(async (agent) => {
          // 🛠️ FIX: Fallback sequence extracts image regardless of variable naming conventions
          const rawAgentImage = agent.profileImage || agent.avatarUrl || agent.photoUrl || "";

          if (rawAgentImage && !rawAgentImage.startsWith('http')) {
            try {
              agent.photoUrl = await getPrivateUrl(rawAgentImage);
            } catch (err) {
              console.error(`Failed to sign URL for agent ${agent._id}:`, err.message);
              agent.photoUrl = rawAgentImage; // Raw key fallback
            }
          } else {
            agent.photoUrl = rawAgentImage; // Assign direct string URL/Base64 or fallback empty string
          }
          return agent;
        })
      );
    }

    res.json({ 
      success: true, 
      user: {
        ...userObj,
        photoUrl: signedPhotoUrl
      } 
    });
  } catch (err) {
    console.error("Profile Fetch Error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// =========================================================================
// 2. UPDATE PROFILE ENDPOINT (SAVES SUB-OBJECTS & SYNCS DATA IMMEDIATELY)
// =========================================================================
app.put('/api/users/update-profile', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    await connectToDatabase();
    const userId = req.user.id;
    const { firstName, lastName, phone, dob, gender, city, state } = req.body;

    // --- 🛠️ PARSE AND SAFE-GUARD PHONE SUB-OBJECT ---
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

    let updateFields = {
      firstName, 
      lastName, 
      phone: parsedPhone, 
      dob, 
      gender, 
      city, 
      state 
    };

    if (req.file) {
      try {
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        updateFields.photoUrl = base64Image; 
      } catch (uploadErr) {
        console.error("Storage upload failed:", uploadErr);
        return res.status(500).json({ success: false, message: "Failed to process image upload" });
      }
    }

    // 🛠️ FIX: Appended fallback fields 'profileImage' and 'avatarUrl' to update selector 
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true } 
    ).populate({
      path: 'connectedAgents',
      select: 'name firstName lastName slug photoUrl profileImage avatarUrl'
    });

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let signedPhotoUrl = updatedUser.photoUrl || null;
    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${updatedUser.firstName || 'User'}+${updatedUser.lastName || ''}&background=0D1117&color=fff&size=128`;
    }

    const updatedUserObj = updatedUser.toObject();

    // Sign nested connected agents photos post-update to stay uniformly integrated
    if (updatedUserObj.connectedAgents && updatedUserObj.connectedAgents.length > 0) {
      updatedUserObj.connectedAgents = await Promise.all(
        updatedUserObj.connectedAgents.map(async (agent) => {
          // 🛠️ FIX: Identical fallback layout checking logic added here to maintain consistency post-update
          const rawAgentImage = agent.profileImage || agent.avatarUrl || agent.photoUrl || "";

          if (rawAgentImage && !rawAgentImage.startsWith('http')) {
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

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        ...updatedUserObj,
        photoUrl: signedPhotoUrl
      }
    });

  } catch (err) {
    console.error("Profile Update Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});
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

    // Now receiving ngnAmount directly from the client/frontend
    const { transaction_id, plan, ngnAmount } = req.body;

    if (!transaction_id) {
      return res.status(400).json({ message: "Transaction ID is required" });
    }

    // Verify transaction with Flutterwave
    const response = await flw.Transaction.verify({ id: transaction_id });
    const data = response.data;
    
    // Strict Verification: Match status, currency, and the exact Naira price
    if (
      data.status === "successful" &&
      data.currency === "NGN" &&
      Number(data.amount) >= Number(ngnAmount)
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
            expiryDate: expiry, 
            expiryNotificationSent: false,
            lastTransactionId: transaction_id,
            paymentDetails: {
              amountNgn: data.amount,
              currency: "NGN",
              verifiedAt: now
            }
          }
        },
        { new: true }
      ).select('-password');

      console.log(`Subscription ACTIVATED for: ${updatedAgent.email} | Amount: ₦${data.amount}`);

      return res.json({
        success: true,
        message: "Payment verified successfully. Secure node activated.",
        agent: updatedAgent
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed. Invalid amount or currency."
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
    
    const agentId = req.user?.id || req.user?._id;
    if (!agentId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const ActiveUserModel = mongoose.models.User || User;
    
    const users = await ActiveUserModel.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl city state isVerified isProfileComplete lastLogin lastActive createdAt')
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
  { 
    $group: { 
      // Ensure we are grouping by the string representation of the senderId
      _id: { $toString: "$senderId" }, 
      count: { $sum: 1 } 
    } 
  }
]);
console.log("SERVER-SIDE AGGREGATION RESULT:", JSON.stringify(unreadCountsData, null, 2));
// Convert the array to an easy lookup map
const unreadMap = unreadCountsData.reduce((acc, item) => {
  acc[item._id] = item.count;
  return acc;
}, {});
    // 3. Process users and attach unreadCount
    const processedUsers = await Promise.all(users.map(async (user) => {
      let finalPhotoUrl = null;

      // ... [Keep your existing photo logic here] ...
      if (user.photoUrl && typeof user.photoUrl === 'string') {
        try {
          let fileKey = user.photoUrl;
          if (fileKey.includes('.com/')) fileKey = fileKey.split('.com/')[1].split('?')[0];
          let cleanKey = fileKey.startsWith('/') ? fileKey.slice(1) : fileKey;
          
          const client = getS3Client(); 
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: cleanKey, 
          });
          finalPhotoUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
        } catch (s3Err) {
          console.error(`[S3 Error] Failed to sign photo for ${user._id}:`, s3Err.message);
        }
      }

      if (!finalPhotoUrl) {
        const name = encodeURIComponent(`${user.firstName || 'U'} ${user.lastName || ''}`);
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
      }

      const lastSeen = user.lastActive || user.lastLogin;
      const isOnline = lastSeen && new Date(lastSeen) > new Date(Date.now() - 5 * 60 * 1000);

      return {
        ...user,
        photoUrl: finalPhotoUrl,   
        avatar: finalPhotoUrl,    
        avatarUrl: finalPhotoUrl,  
        status: isOnline ? 'online' : 'offline',
        unreadCount: unreadMap[user._id.toString()] || 0 
      };
    }));

    return res.json({
      success: true,
      count: processedUsers.length,
      users: processedUsers
    });

  } catch (err) {
    console.error("🔴 CRITICAL ERROR FETCHING AGENT USERS:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});
app.get('/api/messages/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    
    // Add pagination query values with strict defaults
    const limit = parseInt(req.query.limit) || 30;
    const skip = parseInt(req.query.skip) || 0;

    // 1. Fetch messages
    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) // Sort newest first for mobile/chat feeds
    .skip(skip)
    .limit(limit)
    .lean();

    // Find this line in your message route and update it:
const userData = await mongoose.model('User').findById(otherUserId)
  .select('firstName lastName email status isOnline lastActive photoUrl city state phoneNumber') // 👈 Changed lastSeen to lastActive
  .lean();

    // Mapping presigned assets remains fast because it's capped at the limit size
    const signedMessages = await Promise.all(messages.map(async (m) => {
      if (m.fileUrl) {
        let fileKey = m.fileUrl;
        if (fileKey.startsWith('http')) {
          const urlParts = fileKey.split('idrivee2.com/');
          if (urlParts.length > 1) {
            fileKey = urlParts[1].split('/').slice(1).join('/'); 
          }
        }
        m.fileUrl = await getPrivateUrl(fileKey);
      }
      return m;
    }));

    // 3. Return both the messages AND the updated user data to the frontend
    res.json({ 
      success: true, 
      messages: signedMessages.reverse(),
      user: userData // 👈 Sent back dynamically on every room switch
    });
  } catch (err) {
    console.error("Chat Fetch Error:", err);
    res.status(500).json({ success: false, message: "Error loading chat" });
  }
});
// --- NEW: SAVE PUSH SUBSCRIPTION ---
app.post('/api/save-subscription', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { subscription } = req.body;
    const userId = req.user.id;
    
    // Update the correct model based on role
    const Model = req.user.role === 'agent' ? Agent : User;
    await Model.findByIdAndUpdate(userId, { pushSubscription: subscription });

    res.json({ success: true, message: "Push notifications activated" });
  } catch (err) {
    console.error("SUBSCRIPTION ERROR:", err);
    res.status(500).json({ success: false, message: "Failed to save subscription" });
  }
});

// --- SEND MESSAGE ROUTE (HYBRID NOTIFICATION LOGIC) ---
app.post('/api/messages/send', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, text, receiverModel } = req.body;
    const myId = req.user.id;
    const senderRole = req.user.role === 'agent' ? 'Agent' : 'User';

    if (!text || !receiverId) {
      return res.status(400).json({ success: false, message: "Text and receiverId are required" });
    }

    // 1. Create and Save Message
    const newMessage = new Message({
      senderId: myId,
      senderModel: senderRole,
      receiverId,
      receiverModel: receiverModel, // Already passed in body
      text,
      notificationSent: false 
    });
    await newMessage.save();

    // 2. Fetch Receiver and Sender for notification context
    const TargetModel = receiverModel === 'Agent' ? Agent : User;
    const receiver = await TargetModel.findById(receiverId);
    
    const SenderModel = senderRole === 'Agent' ? Agent : User;
    const sender = await SenderModel.findById(myId);

    // 3. Socket.io Connection Check
    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    if (receiver && receiver.pushSubscription) {
      try {
        const payload = JSON.stringify({
          title: `New Message from ${sender.firstName || 'Zing'}`,
          body: text || "Sent an attachment",
          data: { 
            // Fixed variable from finalReceiverModel to receiverModel
            url: receiverModel === 'Agent' 
              ? `/agent/dashboard?userId=${myId}` 
              : `/user/dashboard?agentId=${myId}` 
          }
        });

        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
        newMessage.notificationSent = true;
      } catch (pushErr) {
        console.error("Push delivery failed:", pushErr.message);
      }
    }
if (!isOnline && receiver) {
  try {
    const COOLDOWN = 30 * 60 * 1000; 
    const now = Date.now();
    const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

    if (now - lastEmailTime > COOLDOWN) {
      // await sendWithSES(receiver, sender, text, receiverModel); 
      await sendOfflineNotification(receiver, sender, text, receiverModel);
      
      // 3. Immediately update the database to prevent "race condition" double-sends
      await TargetModel.findByIdAndUpdate(receiverId, { 
        lastNotificationEmail: new Date() 
      });
    }
  } catch (mailErr) {
    console.error("Email Throttle Error:", mailErr.message);
  }
}

    // C. REAL-TIME EMIT
    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", newMessage);
    }

    res.status(201).json({ success: true, message: newMessage });
  } catch (err) {
    console.error("SEND MESSAGE ERROR:", err);
    res.status(500).json({ success: false, message: "Server failed to process message" });
  }
});

app.get('/api/messages/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    
    const limit = parseInt(req.query.limit) || 30;
    const skip = parseInt(req.query.skip) || 0;
        
    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) // 1. SORT NEWEST FIRST
    .skip(skip)              // 2. SKIP NEWEST BATCHES
    .limit(limit)            // 3. GET NEXT OLDEST BATCH
    .populate({ path: 'senderId', select: 'firstName lastName photoUrl slug' })
    .populate({ path: 'receiverId', select: 'firstName lastName photoUrl slug' })
    .lean();
    
    messages.reverse();
    console.log("Backend received skip:", req.query.skip);
    // 2. Map and sign IDrive E2 URLs
    const signedMessages = await Promise.all(messages.map(async (m) => {
      if (m.fileUrl) {
        let fileKey = m.fileUrl;
        if (fileKey.startsWith('http')) {
          const urlParts = fileKey.split('idrivee2.com/');
          if (urlParts.length > 1) {
            const pathParts = urlParts[1].split('/');
            fileKey = pathParts.slice(1).join('/'); 
          }
        }
        m.fileUrl = await getPrivateUrl(fileKey);
      }
      return m;
    }));

    res.json({ success: true, messages: signedMessages });
  } catch (err) {
    console.error("Chat Fetch Error:", err);
    res.status(500).json({ success: false, message: "Error loading chat" });
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
app.post('/api/save-subscription', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();    
    const subscription = req.body.subscription || req.body;
    const userId = req.user.id;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, message: "Invalid subscription data" });
    }
    let role = req.user.role;
    if (!role) {
      const isAgent = await Agent.exists({ _id: userId });
      role = isAgent ? 'agent' : 'user';
    }
    const Model = role === 'agent' ? Agent : User;
    const updated = await Model.findByIdAndUpdate(
      userId,
      { pushSubscription: subscription },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: "User/Agent not found" });
    }

    console.log(`[Push Success] Subscription saved for ${role}: ${userId}`);
    res.json({ success: true });

  } catch (err) {
    console.error("PUSH SAVE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 6. UPLOAD MEDIA ROUTE (WITH PUSH, EMAIL & REDIS PROFILE LOOKUP) ---
app.post('/api/messages/upload', authenticateToken, upload.single('file'), async (req, res) => {
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
    if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });

    const redis = req.app.get('redisClient');
    const mimeType = req.file.mimetype;
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    // Execute Upload to iDrive
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
      senderId: req.user.id,
      senderModel,
      receiverId,
      receiverModel,
      text: text || "", 
      fileUrl: fileName, 
      fileType: detectedType,
      status: 'sent',
      notificationSent: false
    });
    await newMessage.save();

    // NOTIFICATION LOGIC (SPEED OPTIMIZED VIA REDIS)
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
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      receiver = await TargetModel.findById(receiverId).lean();
      if (receiver && redis) {
        await redis.setEx(`profile:${receiverId}`, 1800, JSON.stringify(receiver)).catch(() => {});
      }
    }

    if (!sender) {
      const SenderModel = isAgent ? Agent : User;
      sender = await SenderModel.findById(req.user.id).lean();
      if (sender && redis) {
        await redis.setEx(`profile:${req.user.id}`, 1800, JSON.stringify(sender)).catch(() => {});
      }
    }

    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    // Web Push Notification
    if (receiver?.pushSubscription) {
      try {
        const payload = JSON.stringify({
          title: `New ${detectedType} from ${sender.firstName || 'Zing'}`,
          body: text || (detectedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo"),
          data: {
            url: isAgent ? `/user/dashboard` : `/agent/dashboard?userId=${req.user.id}`
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
      } catch (pushErr) {
        console.error("Media Push delivery failed:", pushErr.message);
      }
    }

    if (!isOnline && receiver) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const now = Date.now();
        const lastEmail = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (now - lastEmail > COOLDOWN) {
          await sendOfflineNotification(receiver, sender, text, fileName, detectedType, receiverModel);
          
          const TargetModel = receiverModel === 'Agent' ? Agent : User;
          await TargetModel.findByIdAndUpdate(receiverId, { 
            lastNotificationEmail: new Date() 
          });

          // Clear out mutated database string in Redis
          if (redis) {
            await redis.del(`profile:${receiverId}`).catch(() => {});
          }
          console.log(`[Email] Offline media notification sent to ${receiver.email}`);
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", newMessage);
    }

    const responseData = newMessage.toObject();
    responseData.fileUrl = await getPrivateUrl(fileName);

    res.status(201).json({ success: true, message: responseData });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ success: false, message: "Upload failed", error: err.message });
  }
});

// --- 1. GET UPLOAD PERMISSION (Presigned URL generation does not require modifications) ---
app.post('/api/messages/get-upload-url', authenticateToken, async (req, res) => {
  try {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "File metadata missing" });
    }
    const fileExtension = fileName.split('.').pop();
    const key = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;
    const client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

    res.json({ success: true, uploadUrl, key });
  } catch (err) {
    console.error("Presigned URL Error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Could not generate upload pass", 
      error: err.message 
    });
  }
});

// --- 2. CONFIRM UPLOAD & SAVE TO DB (REDIS OPTIMIZED) ---
app.post('/api/messages/confirm-upload', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase(); 

    let connectionRetries = 0;
    while (mongoose.connection.readyState !== 1 && connectionRetries < 5) {
      console.log(`⏳ Waiting for DB stabilization... Attempt ${connectionRetries + 1}`);
      await new Promise(resolve => setTimeout(resolve, 400)); 
      connectionRetries++;
    }

    if (mongoose.connection.readyState !== 1) {
      throw new Error(`Database connection not ready. State: ${mongoose.connection.readyState}`);
    }

    const { receiverId, text, fileUrl, fileType } = req.body;
    if (!receiverId || !fileUrl) {
      return res.status(400).json({ success: false, message: "Missing receiverId or fileUrl" });
    }

    const redis = req.app.get('redisClient');
    const isAgent = req.user.role === 'agent';
    const receiverModel = isAgent ? 'User' : 'Agent';
    const senderModel = isAgent ? 'Agent' : 'User';

    // Save Message to Database
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: senderModel,
      receiverId,
      receiverModel: receiverModel,
      text: text || "",
      fileUrl: fileUrl, 
      fileType: fileType,
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
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      receiver = await TargetModel.findById(receiverId).lean();
      if (receiver && redis) {
        await redis.setEx(`profile:${receiverId}`, 1800, JSON.stringify(receiver)).catch(() => {});
      }
    }

    if (!sender) {
      const SenderModel = isAgent ? Agent : User;
      sender = await SenderModel.findById(req.user.id).lean();
      if (sender && redis) {
        await redis.setEx(`profile:${req.user.id}`, 1800, JSON.stringify(sender)).catch(() => {});
      }
    }

    const io = req.app.get('socketio');
    const isOnline = io?.sockets.adapter.rooms.has(receiverId.toString());

    // Web Push
    if (receiver?.pushSubscription) {
      try {
        const payload = JSON.stringify({
          title: `New ${fileType} from ${sender.firstName || 'Zing'}`,
          body: text || `Sent an attachment`,
          data: { 
            url: isAgent ? `/user/dashboard` : `/agent/dashboard?userId=${req.user.id}` 
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
      } catch (pushErr) {
        console.error("Push delivery failed:", pushErr.message);
      }
    }

    // Email Notification
    if (!isOnline && receiver) {
      try {
        const COOLDOWN = 30 * 60 * 1000; 
        const now = Date.now();
        const lastEmailTime = receiver.lastNotificationEmail ? new Date(receiver.lastNotificationEmail).getTime() : 0;

        if (now - lastEmailTime > COOLDOWN) {
          const emailText = text || `Sent a ${fileType} attachment`;
          await sendOfflineNotification(receiver, sender, emailText, fileUrl, fileType, receiverModel);
          
          const TargetModel = receiverModel === 'Agent' ? Agent : User;
          await TargetModel.findByIdAndUpdate(receiverId, { 
            lastNotificationEmail: new Date() 
          });

          if (redis) {
            await redis.del(`profile:${receiverId}`).catch(() => {});
          }
          console.log(`[Email] Offline notification for ${fileType} sent to ${receiver.email}`);
        }
      } catch (mailErr) {
        console.error("Email Throttle Error:", mailErr.message);
      }
    }

    if (isOnline) {
      io.to(receiverId.toString()).emit("new-message", newMessage);
    }

    const signedUrlForFrontend = await getPrivateUrl(fileUrl);
    const responseData = newMessage.toObject();
    responseData.fileUrl = signedUrlForFrontend;

    res.status(201).json({ 
      success: true, 
      message: responseData 
    });

  } catch (err) {
    console.error("❌ Confirmation Route Error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to save message", 
      error: err.message 
    });
  }
});

// --- DELETE MESSAGE ROUTE ---
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const messageId = req.params.id;
    const myId = req.user.id;
    const message = await Message.findOne({ _id: messageId, senderId: myId });

    if (!message) {
      return res.status(404).json({ 
        success: false, 
        message: "Message not found or you do not have permission to delete it." 
      });
    }
    await Message.findByIdAndDelete(messageId);
    const io = req.app.get('socketio');
    if (io) {
      io.to(message.receiverId.toString()).emit("message-deleted", messageId);
    }

    res.json({ success: true, message: "Message deleted successfully" });
  } catch (err) {
    console.error("DELETE MESSAGE ERROR:", err);
    res.status(500).json({ success: false, message: "Server failed to delete message" });
  }
});

app.patch('/api/messages/mark-read/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    const myId = req.user?.id || req.user?._id;
    const { otherUserId } = req.params;
    const result = await Message.updateMany(
      { 
        senderId: otherUserId, 
        receiverId: myId, 
        status: { $ne: 'seen' } 
      },
      { 
        $set: { 
          status: 'seen', 
          seenAt: new Date() 
        } 
      }
    );
        const io = req.app.get('socketio');
    if (io) {
      io.to(otherUserId.toString()).emit("messages-seen", { 
        readerId: myId 
      });
    }

    res.json({ 
      success: true, 
      count: result.modifiedCount 
    });
  } catch (err) {
    console.error("🔴 Error marking messages as read:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update message status" 
    });
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

// Modified to use email to match your AdminSchema and React Frontend
app.post('/api/admin/register', async (req, res) => {
  try {
    // 1. Force the database connection before any queries
    await connectToDatabase(); 

    // 2. Destructure 'email' instead of 'username' to match frontend formData
    const { firstName, lastName, email, password, role } = req.body;
    
    // 3. Updated validation check
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const lowerEmail = email.toLowerCase().trim();
    
    // 4. Check for existing admin using email
    const existingAdmin = await Admin.findOne({ email: lowerEmail });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Admin email already exists" });
    }

    const newAdmin = new Admin({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: lowerEmail, // Matches your updated AdminSchema
      password: password, // Schema hashes this automatically via middleware
      role: role || 'superadmin' 
    });

    // 5. Save to the database
    await newAdmin.save();

    res.status(201).json({ 
      success: true, 
      message: "Administrator account created successfully" 
    });

  } catch (err) {
    console.error("Admin Reg Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error creating admin account",
      details: err.message 
    });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    await connectToDatabase(); 
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Email and password are required" 
      });
    }
    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid admin credentials" 
      });
    }
    const token = jwt.sign(
      { id: admin._id, role: admin.role || 'superadmin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.status(200).json({ 
      success: true, 
      token, 
      admin: { 
        id: admin._id,
        firstName: admin.firstName, 
        lastName: admin.lastName,
        role: admin.role 
      } 
    });
  } catch (err) {
    console.error("Admin Login Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "An error occurred during terminal access", 
      details: err.message 
    });
  }
});

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();

    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalAgents, pendingAgents, dailyRev, weeklyRev, monthlyRev, yearlyRev, dynamicChart] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ isVerified: false }),
            Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfYear } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),
      Agent.aggregate([
      { 
  $match: { 
    isSubscribed: true, 
    subscriptionDate: { $ne: null, $gte: sevenDaysAgo } 
  } 
},
{
  $group: {
    // Ensure subscriptionDate exists before calling $dayOfWeek
    _id: { $dayOfWeek: { $ifNull: ["$subscriptionDate", new Date()] } }, 
    revenue: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } }
  }
},
        {
          $project: {
            revenue: 1,
            order: "$_id",
            name: {
              $switch: {
                branches: [
                  { case: { $eq: ["$_id", 1] }, then: "Sun" },
                  { case: { $eq: ["$_id", 2] }, then: "Mon" },
                  { case: { $eq: ["$_id", 3] }, then: "Tue" },
                  { case: { $eq: ["$_id", 4] }, then: "Wed" },
                  { case: { $eq: ["$_id", 5] }, then: "Thu" },
                  { case: { $eq: ["$_id", 6] }, then: "Fri" },
                  { case: { $eq: ["$_id", 7] }, then: "Sat" }
                ],
                default: "Unknown"
              }
            }
          }
        },
        { $sort: { order: 1 } }
      ])
    ]);

    const chartData = dynamicChart.map(item => ({
      name: item.name,
      revenue: item.revenue
    }));

    res.json({
      success: true,
      totalAgents,
      pendingAgents,
      currency: "NGN",
      currencySymbol: "₦",
      revenue: {
        daily: dailyRev[0]?.total || 0,
        weekly: weeklyRev[0]?.total || 0,
        monthly: monthlyRev[0]?.total || 0,
        yearly: yearlyRev[0]?.total || 0
      },
      chartData: chartData.length > 0 ? chartData : [{ name: 'No Data', revenue: 0 }]
    });

  } catch (err) {
    console.error("Critical: Stats API Failure", err);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching system financial stats",
      details: err.message 
    });
  }
});

app.get('/api/admin/agents', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
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

    res.json({
      success: true,
      agents: formattedAgents
    });
  } catch (err) {
    console.error("Admin List Fetch Error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch agent list",
      error: err.message 
    });
  }
});

// 2. FETCH SINGLE AGENT (DETAILED VIEW)
app.get('/api/admin/agents/:id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Fetch agent and lean for performance
    const agent = await Agent.findById(req.params.id).lean();
    
    if (!agent) {
      return res.status(404).json({
        success: false,
        message: "Agent record not found in system"
      });
    }
    const now = new Date();
    let statusUpdate = {};
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      statusUpdate.isSubscribed = false;
      agent.isSubscribed = false; // Update local object for response
    }
    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
      statusUpdate.voicePackageActive = false;
      agent.voicePackageActive = false; // Update local object for response
    }

    if (Object.keys(statusUpdate).length > 0) {
      await Agent.updateOne({ _id: agent._id }, { $set: statusUpdate });
    }
    let finalPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        const urlParts = agent.photoUrl.split('.com/');
        const fileKey = urlParts.length > 1 ? urlParts[1].split('?')[0] : null;

        if (fileKey) {
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME,
            Key: decodeURIComponent(fileKey),
          });
          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (signErr) {
        console.error("Admin View: Image Signing Failed:", signErr.message);
      }
    }
    if (!finalPhotoUrl) {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }
    const lastActiveDate = agent.lastActive || agent.createdAt;
    const isOnline = (now - new Date(lastActiveDate)) < 120000;

    // --- 4. RETURN FORMATTED RESPONSE ---
    res.json({
      success: true,
      agent: {
        _id: agent._id,
        email: agent.email,
        firstName: agent.firstName,
        lastName: agent.lastName,
        occupation: agent.occupation,
        program: agent.program,
        bio: agent.bio,
        gender: agent.gender, 
        dob: agent.dob,
        address: agent.address,
        photoUrl: finalPhotoUrl,
        slug: agent.slug,
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed, 
        subscriptionDate: agent.subscriptionDate,
        expiryDate: agent.expiryDate,
        subscriptionAmount: agent.subscriptionAmount || 0,
        voiceId: agent.voiceId, 
        unlockedVoiceIds: agent.unlockedVoiceIds || [], 
        voiceDisplayName: agent.voiceDisplayName || "Natural Voice",
        voicePackageActive: !!agent.voicePackageActive, 
        voicePackageExpiry: agent.voicePackageExpiry,
        voiceMaskingEnabled: !!agent.voiceMaskingEnabled,
        isVerified: !!agent.isVerified,
        status: isOnline ? 'online' : 'offline',
        lastActive: agent.lastActive,
        createdAt: agent.createdAt,
        paymentDetails: agent.paymentDetails || {}
      }
    });

  } catch (err) {
    console.error("Admin Agent Fetch Error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error accessing agent data" 
    });
  }
});

app.post('/api/support/send', async (req, res) => {
  try {
    await connectToDatabase(); 
    const { guestId, text } = req.body;

    if (!guestId || !text) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    const savedMsg = await SupportMessage.create({
      guestId: String(guestId),
      text: text,
      senderType: 'Guest',
      isAdminRead: false
    });
    const socketIo = req.app.get('socketio') || req.io;

    if (socketIo) {
      socketIo.emit("admin_receive_support_message", {
        _id: savedMsg._id,
        guestId: savedMsg.guestId,
        text: savedMsg.text,
        isAdmin: false,
        timestamp: savedMsg.createdAt
      });
      console.log("✅ Socket emit successful via app settings");
    } else {
      console.warn("⚠️ Socket.io instance not found in req.app or req.io");
    }

    res.status(200).json({ success: true, message: "Message Stored" });
  } catch (err) {
    console.error("API Save Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/support/history/:guestId', async (req, res) => {
  try {
    const { guestId } = req.params;
    const messages = await SupportMessage.find({ guestId }).sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- BACKEND: Get list of all unique guests who messaged ---
app.get('/api/admin/support/guests', async (req, res) => {
  try {
    const guests = await SupportMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: {
          _id: "$guestId",
          lastMessage: { $first: "$text" },
          createdAt: { $first: "$createdAt" }
      }},
      { $sort: { createdAt: -1 } }
    ]);
    res.json({ success: true, guests });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/admin/support/messages/:guestId', async (req, res) => {
  try {
    const { guestId } = req.params;
    await connectToDatabase(); 
    const messages = await SupportMessage.find({ guestId: String(guestId) }).sort({ createdAt: 1 });
    res.status(200).json({ 
      success: true, 
      messages: messages.map(msg => ({
        _id: msg._id,
        text: msg.text,
        isAdmin: msg.senderType === 'Admin',
        timestamp: new Date(msg.createdAt).toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post('/api/admin/broadcast-news', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const { target, emails, subject, message, category = 'news' } = req.body;

    // 1. Resolve Recipient Data (Fetching both email and slug)
    let recipients = [];
    if (target === 'all') {
      // We need 'slug' to create the personalized link
      recipients = await Agent.find({}, 'email slug'); 
    } else {
      // If specific emails are sent, find the corresponding slugs
      recipients = await Agent.find({ email: { $in: emails } }, 'email slug');
    }

    if (recipients.length === 0) {
      return res.status(400).json({ success: false, message: "No recipients found." });
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
    const emailPromises = recipients.map(agent => {
      const agentSlugLink = agent.slug ? `${baseUrl}/agent/${agent.slug}` : `${baseUrl}/agent/login`;

      const mailOptions = {
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
      };
      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);
    return res.json({ success: true, message: "Personalized broadcast dispatched successfully." });

  } catch (err) {
    console.error("Broadcast API Error:", err.message);
    return res.status(500).json({ success: false, message: "Broadcast failed", details: err.message });
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
    return res.status(500).json({ 
      success: false, 
      status: "Degraded", 
      error: err.message 
    });
  }
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`--- LOCAL SERVER ACTIVE ON PORT ${PORT} ---`);
  });
}

export default app;