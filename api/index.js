console.log("--- ATTEMPTING TO START SERVER ---");
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path'; // <--- Kept this one
import fs from 'fs';   // <--- Kept this one
import jwt from 'jsonwebtoken'; 
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import WebSocket from 'ws';
import nodemailer from 'nodemailer';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import { fileURLToPath } from 'url';
import Agent from './models/Agent.js';
import User from './models/User.js'; 
import Message from './models/Message.js';
import Admin from './models/Admin.js';
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/message.js'; 
import webpush from 'web-push';
import { Server } from 'socket.io';
import http from 'http';
import { connectToDatabase } from './config/db.js';
import { getS3Client, getPrivateUrl } from './config/s3.js';
import { createLiveKitToken } from './utils/livekitHelper.js';
import callRoutes from './routes/callRoutes.js';
import Call from './models/Call.js'; 
import { sendOfflineNotification } from './utils/mailer.js';
import adminRoutes from './routes/admin.js'; 

dotenv.config();

const app = express();

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
  cors: corsOptions
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
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
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
      // 1. Logic for Agents: Session Mismatch & Last Active
      if (decoded.role === 'agent') {
        const agent = await Agent.findById(req.user.id).select('currentSessionId lastActive');
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
        agent.lastActive = new Date();
        await agent.save();
      }

      // 2. Logic for Admins: Last Login Update (Optional)
      if (decoded.role === 'admin') {
        await Admin.findByIdAndUpdate(req.user.id, { lastLogin: new Date() });
      }

      next();
    } catch (dbErr) {
      console.error("Auth DB Error:", dbErr);
      return res.status(500).json({ message: "Internal Auth Error" });
    }
  });
};

// --- Added Admin Authorization Middleware ---
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
    socket.userId = userId; // Store this for the disconnect event later
    socket.join(userId.toString());
        await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
    io.emit("user_status_update", { 
      userId, 
      isOnline: true, 
      lastSeen: new Date() 
    });
    
    console.log(`User ${userId} is online.`);
  }
});
socket.on("call-user", async ({ userToCall, fromId, fromName, photoUrl, roomName }) => {
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
      roomName: roomName.trim() 
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
socket.on("answer-call", async ({ to, callId, myId }) => {
  if (!callId || !myId) return;
  
  // Ensure the room name and identity are clean strings
  const roomName = String(callId).trim();
  const participantId = String(myId).trim();

  try {
    // This is the CRITICAL part that clears the "faded" state
    const token = await createLiveKitToken(roomName, participantId);
    
    // Send token back to the person who just answered
    socket.emit("livekit-token", { token, roomName });

    // Notify the original caller that the call is now live
    if (to) {
      io.to(to.toString()).emit("call-accepted", { 
        callId: roomName,
        roomName: roomName 
      });
    }

    // Update DB in background so we don't slow down the audio connection
    Call.findByIdAndUpdate(callId, { 
      status: 'connected',
      startTime: new Date() 
    }).catch(err => console.error("❌ DB Update Fail:", err.message));

  } catch (err) {
    console.error("❌ Socket Answer Error:", err.message);
    socket.emit("call-error", { message: "Failed to join audio room" });
  }
});

 socket.on("end-call", async ({ to, callId }) => {
  try {
    if (callId) {
      // 1. Force the database to stop the poller from finding this call again
      const endedCall = await Call.findByIdAndUpdate(callId, { 
        status: 'ended', 
        endTime: new Date(), // Use new Date() for Mongoose consistency
        active: false // CRITICAL: This is what stops the ghost ringing
      }, { new: true });

      if (endedCall) {
        const durationSeconds = endedCall.startTime 
          ? Math.floor((Date.now() - new Date(endedCall.startTime)) / 1000) 
          : 0;

        const callLogEntry = new Message({
          senderId: endedCall.caller,
          senderModel: endedCall.callerModel,
          receiverId: endedCall.receiver,
          receiverModel: endedCall.receiverModel,
          fileType: 'call_log',
          text: `Voice Call Ended (${durationSeconds}s)`, 
          callMetadata: {
            callId: endedCall._id,
            status: 'ended',
            duration: durationSeconds
          }
        });

        await callLogEntry.save();
        io.to(endedCall.caller.toString()).emit("new-message", callLogEntry);
        io.to(endedCall.receiver.toString()).emit("new-message", callLogEntry);
      }
    }
    if (to) {
      const targetRoom = to.toString().trim();
      io.to(targetRoom).emit("call-ended", { callId });
      io.to(targetRoom).emit("end-call", { callId }); // Some frontends use this name
    }
  } catch (err) {
    console.error("❌ Socket End Call Error:", err);
  }
});

socket.on("reject-call", async ({ to, fromId, callId }) => {
  try {
    if (callId) {
      const call = await Call.findByIdAndUpdate(
        callId, 
        { status: 'rejected', active: false }, // Set active: false here too!
        { new: true }
      );

      if (call) {
        const missedCallLog = new Message({
          senderId: fromId,
          senderModel: call.receiverModel,
          receiverId: to,
          receiverModel: call.callerModel,
          fileType: 'call_log',
          text: 'Call Rejected',
          callMetadata: { callId: callId, status: 'rejected' }
        });
        
        await missedCallLog.save();
        io.to(to.toString()).emit("new-message", missedCallLog);
        io.to(fromId.toString()).emit("new-message", missedCallLog);
      }
    }
        if (to) {
      io.to(to.toString()).emit("call-rejected", { callId });
      io.to(to.toString()).emit("call-ended", { callId }); // Extra safety
    }
  } catch (err) {
    console.error("❌ Reject Log Error:", err);
  }
});

socket.on("disconnect", async () => {
  console.log("Socket disconnected:", socket.id);
  if (socket.userId) {
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
  try {
    const db = await connectToDatabase();
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        message: "Database connection temporarily unavailable" 
      });
    }
    next();
  } catch (error) {
    console.error("Middleware DB Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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
    
    // 1. Fetch Agent & Check Session Security
    const agent = await AgentModel.findById(req.user.id);

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    if (req.user.sessionId && agent.currentSessionId && req.user.sessionId !== agent.currentSessionId) {
      return res.status(403).json({ 
        success: false, 
        message: "Dual login detected. Account is active on another device.",
        reason: "dual_login" 
      });
    }
    agent.lastActive = new Date();
    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
    }
    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
        agent.voicePackageActive = false;
    }
    await agent.save();
    const lastActiveDate = agent.lastActive || agent.createdAt;
    const isOnline = (now - new Date(lastActiveDate)) < (120000);

    // 5. Safe S3 Signing
    let signedPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        if (typeof GetObjectCommand !== 'undefined' && typeof s3Client !== 'undefined') {
          const fileKey = agent.photoUrl.split('.com/')[1];
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: decodeURIComponent(fileKey),
          });
          signedPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (s3Err) {
        console.error("IDrive Signing Error:", s3Err.message);
        signedPhotoUrl = agent.photoUrl; 
      }
    }

    // 6. Default Avatar Fallback
    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // 7. Clean JSON Response
    res.json({
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
        subscriptionAmount: agent.subscriptionAmount || 0,
        expiryDate: agent.expiryDate || null,
        paymentDetails: agent.paymentDetails || { amountNgn: 0, currency: "NGN" },
        voiceId: agent.voiceId || "nPczCjzB2QC9zZ6ULpFM",
        voicePackageActive: !!agent.voicePackageActive, 
        status: isOnline ? 'online' : 'offline',
        lastActive: agent.lastActive
      }
    });

  } catch (err) {
    console.error("CRITICAL ROUTE ERROR:", err.message);
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

    if (activeAgent) {
      const freshAgent = await Agent.findById(activeAgent._id).lean();
      
      if (freshAgent) {
        const now = new Date();
        const lastActive = freshAgent.lastActive || freshAgent.createdAt;
        
        // Online if activity was within the last 2 minutes (120,000ms)
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
    }

    // 4. IDrive / S3 Image Signing Logic
    let signedPhotoUrl = activeAgent?.photoUrl;
    if (activeAgent?.photoUrl && activeAgent.photoUrl.includes('idrivee2.com')) {
      try {
        const fileKey = activeAgent.photoUrl.split('.com/')[1];
        const command = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: decodeURIComponent(fileKey),
        });
        signedPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      } catch (err) {
        console.error("Image signing failed:", err);
        // Fallback to original URL if signing fails
      }
    }

    // 5. Final Response
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        isProfileComplete: user.isProfileComplete,
        lastActive: user.lastActive
      },
      agent: activeAgent ? {
        // Convert Mongoose doc to plain object for spreading
        ...(activeAgent.toObject ? activeAgent.toObject() : activeAgent),
        photoUrl: signedPhotoUrl,
        status: isOnline ? 'online' : 'offline',
        lastSeenText: lastSeenDisplay
      } : null
    });

  } catch (err) {
    console.error("Session Error:", err);
    res.status(500).json({ 
      message: "Session Error", 
      error: err.message 
    });
  }
});

app.put('/api/users/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    // Ensure DB connection
    await connectToDatabase();
    const { firstName, lastName, dob, gender, city, state, phone } = req.body;

    const updateData = {
      firstName,
      lastName,
      phone, // New field saved here
      dob,
      gender,
      city,
      state,
      isProfileComplete: true,
      isVerified: true
    };

    if (req.file) {
      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${req.user.id}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME,
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };
      await s3Client.send(new PutObjectCommand(uploadParams));
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
    console.log("--- Profile Request Start --- for:", req.params.slug);
    
    await connectToDatabase();
    const AgentModel = getAgentModel(); 

    if (!AgentModel) {
      return res.status(500).json({ message: "Configuration Error: Agent Model not found" });
    }

    const agent = await AgentModel.findOne({ slug: req.params.slug }).select('-password').lean();
    
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

// GET current user's full profile data
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Find user and exclude sensitive fields like password if they existed
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    let signedPhotoUrl = user.photoUrl;
    if (user.photoUrl && user.photoUrl.includes('users/')) {
      try {
        const command = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME,
          Key: user.photoUrl, // This is the fileKey we saved during onboarding
        });
        signedPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      } catch (err) {
        console.error("User photo signing failed:", err);
      }
    }
    res.json({ 
      success: true, 
      user: {
        ...user.toObject(),
        photoUrl: signedPhotoUrl
      } 
    });
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// --- Utility Function to calculate Fixed Naira Amount ---
const getNairaAmount = (usdAmount) => {
  const FIXED_RATE = Number(process.env.USD_TO_NGN_RATE);
  
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
    
    const agentId = req.user.id || req.user._id;

    if (!agentId) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid Agent session. Missing ID." 
      });
    }

    const users = await User.find({ connectedAgents: agentId })
      .select('firstName lastName email phone photoUrl city state isVerified isProfileComplete lastLogin lastActive createdAt')
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

app.get('/api/messages/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    const limit = parseInt(req.query.limit) || 20;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) // Get newest first for pagination
    .limit(limit)
    .lean();

    // Reverse to chronological order for the UI
    const chronologicalMessages = messages.reverse();

    const signedMessages = await Promise.all(chronologicalMessages.map(async (m) => {
      // 1. Handle File/Image signing
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

// --- UPDATED: GET CHAT MESSAGES WITH SANITIZATION ---
app.get('/api/messages/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    }).sort({ createdAt: 1 }).lean();
    const signedMessages = await Promise.all(messages.map(async (m) => {
      if (m.fileUrl) {
        let fileKey = m.fileUrl;
        if (fileKey.startsWith('http')) {
          const urlParts = fileKey.split('idrivee2.com/');
          if (urlParts.length > 1) {
            // Split by '/' and remove the first part (the bucket name)
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

// --- 6. UPLOAD MEDIA ROUTE (WITH PUSH) ---
app.post('/api/messages/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    await connectToDatabase();
    
    // 1. Destructure 'text' (the caption) from the frontend
    const { receiverId, text } = req.body; 

    if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });

    const mimeType = req.file.mimetype;
    const detectedType = mimeType.startsWith('video') ? 'video' : 'image';
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    // 2. Execute Upload to iDrive
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

    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';

    // 3. Save Message to Database
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel: receiverModel,
      text: text || "", 
      fileUrl: fileName, 
      fileType: detectedType,
      status: 'sent',
      notificationSent: false // Default to false
    });

    await newMessage.save();
    const responseData = newMessage.toObject();
    responseData.fileUrl = await getPrivateUrl(fileName);
    try {
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);

      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New ${detectedType} from ${req.user.firstName || 'Zing'}`,
          body: text ? text : (detectedType === 'video' ? "🎥 Sent a video" : "📷 Sent a photo"),
          data: {
            url: receiverModel === 'Agent' ? '/agent-dashboard' : '/user-dashboard'
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
        responseData.notificationSent = true; 
        
        console.log(`[Push] Media notification sent for message: ${newMessage._id}`);
      }
    } catch (pushErr) {
      console.error("Media Push delivery failed:", pushErr.message);
    }

    // 6. Final Response
    res.status(201).json({ success: true, message: responseData });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ success: false, message: "Upload failed" });
  }
});

// --- 1. GET UPLOAD PERMISSION ---
app.post('/api/messages/get-upload-url', authenticateToken, async (req, res) => {
  try {
    const { fileName, fileType } = req.body;

    if (!fileName || !fileType) {
      return res.status(400).json({ success: false, message: "File metadata missing" });
    }
    
    const fileExtension = fileName.split('.').pop();
    const key = `chat/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    // Use the s3Client defined in your index.js
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    res.json({ success: true, uploadUrl, key });
  } catch (err) {
    console.error("Presigned URL Error:", err);
    res.status(500).json({ success: false, message: "Could not generate upload pass", error: err.message });
  }
});

// --- 2. CONFIRM UPLOAD & SAVE TO DB ---
app.post('/api/messages/confirm-upload', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase(); // Ensure DB is connected for Vercel Serverless
    const { receiverId, text, fileUrl, fileType } = req.body;

    const receiverModel = req.user.role === 'agent' ? 'User' : 'Agent';
    
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel,
      text: text || "",
      fileUrl: fileUrl, 
      fileType: fileType,
      status: 'sent'
    });

    await newMessage.save();
        const signedUrlForFrontend = await getPrivateUrl(fileUrl);
    
    const responseData = newMessage.toObject();
    responseData.fileUrl = signedUrlForFrontend;

    res.status(201).json({ success: true, message: responseData });
  } catch (err) {
    console.error("Confirmation Error:", err);
    res.status(500).json({ success: false, message: "Failed to save message", error: err.message });
  }
});

// --- DELETE MESSAGE ROUTE (SECURE) ---
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

    // 1. Generate LiveKit Token
    const token = await createLiveKitToken(roomName, callerId);

    // 2. Create DB Record FIRST (Remove setImmediate)
    // This prevents the 404/Automatic termination on the frontend
    await connectToDatabase();
    const CallModel = mongoose.models.Call || mongoose.model('Call');
    
    const newCall = await CallModel.create({
      roomName,
      caller: callerId,
      callerModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiver: targetId,
      receiverModel: req.user.role === 'agent' ? 'User' : 'Agent',
      status: 'ringing',
      active: true
    });

    console.log("✅ DB: Call record created strictly before response");

    // 3. Emit Socket Event
    const io = req.app.get('socketio');
    if (io) {
      io.to(targetId).emit("incoming-call", {
        fromId: callerId,
        fromName: req.user.firstName || "Secure Caller",
        roomName: roomName,
        voiceId: voiceId || null
      });
    }

    // 4. Send Success Response including the DB _id
    res.status(201).json({
      success: true,
      lkToken: token,
      roomName: roomName,
      callId: newCall._id // Use this ID for polling
    });

  } catch (err) {
    console.error("🔥 CRITICAL ROUTE ERROR:", err.stack);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Call failed to start" });
    }
  }
});

app.get('/api/calls/check-incoming', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const rawId = req.user?._id || req.user?.id || req.user?.userId;
    
    // --- FIX: Only look for calls created in the last 60 seconds ---
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);

    let incoming = await Call.findOne({ 
      receiver: rawId,
      status: { $in: ['calling', 'ringing'] },
      active: true,
      createdAt: { $gte: sixtySecondsAgo } // Ignores old/stale records
    })
    .sort({ createdAt: -1 })
    .populate('caller', 'firstName lastName photoUrl'); 

    if (!incoming) return res.json({ hasIncomingCall: false });

    // Handle IDrive Photo Signing
    let finalPhotoUrl = incoming.caller?.photoUrl || "/default-avatar.png";
    if (finalPhotoUrl.includes('idrivee2.com')) {
      try {
        const fileKey = finalPhotoUrl.split('.com/')[1];
        const command = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME,
          Key: decodeURIComponent(fileKey),
        });
        finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      } catch (s3Err) {
        console.error("S3 Signing failed:", s3Err);
      }
    }

    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      status: incoming.status, 
      roomName: incoming._id.toString(),
      voiceId: incoming.voiceId,
      callerData: {
        fromName: incoming.caller ? `${incoming.caller.firstName} ${incoming.caller.lastName}`.trim() : "Secure Caller",
        photoUrl: finalPhotoUrl,
        callerId: incoming.caller?._id
      }
    });
  } catch (err) {
    console.error("Poll Route Error:", err);
    res.status(500).json({ hasIncomingCall: false });
  }
});

app.patch('/api/calls/update-signal', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;

    // 1. SAFE ID EXTRACTION
    const userPayload = req.user;
    const myId = (userPayload?._id || userPayload?.id || userPayload?.userId || userPayload?.sub)?.toString();

    if (!myId) {
      console.error("❌ Signal Update: No user ID found in request");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // 2. FIND THE CALL
    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" });
    }
    
    // 3. IDENTIFY ROLE & NORMALIZE SIGNAL
    const isAnswer = call.receiver.toString() === myId;
    const processedSignal = typeof signal === 'object' ? JSON.stringify(signal) : signal;
    
    // 4. PREPARE UPDATE DATA
    const updateData = isAnswer 
      ? { 
          answerSignal: processedSignal, 
          status: 'connected', 
          startTime: Date.now() 
        } 
      : { 
          signal: processedSignal 
        };

    const updatedCall = await Call.findByIdAndUpdate(callId, updateData, { new: true });

    // 5. RETRIEVE SOCKET.IO FROM APP INSTANCE
    const socketIo = req.app.get('socketio');

    if (socketIo) {
      // FIX: Use 'isAnswer' (defined above) and 'processedSignal'
      const targetId = isAnswer ? updatedCall.caller.toString() : updatedCall.receiver.toString();
      const eventName = isAnswer ? "call-accepted" : "incoming-call";
      
      console.log(`📡 Relaying ${eventName} to target: ${targetId}`);
      
      socketIo.to(targetId).emit(eventName, { 
        signal: processedSignal, 
        callId: updatedCall._id,
        fromName: req.user.firstName || "Secure Connection"
      });
    } else {
      console.error("❌ Socket.io instance not found on req.app. Check app.set('socketio', io) in server.js");
    }

    // 6. FINAL RESPONSE
    res.json({ 
      success: true, 
      status: updatedCall.status,
      signal: isAnswer ? updatedCall.answerSignal : updatedCall.signal 
    });

  } catch (err) {
    console.error("🔥 Signal Update Route Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/calls/accept/:callId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const callId = req.params.callId || req.body.callId;
    const myId = (req.user.id || req.user._id).toString();
    const isObjectId = mongoose.Types.ObjectId.isValid(callId);
    const call = await Call.findOneAndUpdate(
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

app.post('/api/calls/end/:callId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    // Supporting both params and body covers all frontend fetch variations
    const myId = (req.user.id || req.user._id || req.user.userId).toString();
    const callId = req.params.callId || req.body.callId; 

    const isObjectId = mongoose.Types.ObjectId.isValid(callId);

    let query = {
      $and: [
        { $or: [{ roomName: callId }, { _id: isObjectId ? callId : null }] },
        { $or: [{ caller: myId }, { receiver: myId }] },
        { active: true } // Only target the live call to prevent updating history
      ]
    };

    if (!callId) {
      query = { 
        $or: [{ caller: myId }, { receiver: myId }], 
        active: true 
      };
    }

    const call = await Call.findOneAndUpdate(
      query,
      { 
        status: 'ended', 
        endTime: new Date(), 
        active: false // CRITICAL: This stops the background poller loop
      },
      { new: true, sort: { createdAt: -1 } }
    );

    if (call) {
      // 1. Calculate Duration for the Log
      const durationSeconds = call.startTime 
        ? Math.floor((new Date() - new Date(call.startTime)) / 1000) 
        : 0;

      // 2. Create Chat Log Entry (Keeps UI synced and shows call history)
      const callLogEntry = new Message({
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
  }
});

app.get('/api/calls/status/:callId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { callId } = req.params;
    let call = await Call.findOne({ roomName: callId }).select('status active startTime');

    if (!call && mongoose.Types.ObjectId.isValid(callId)) {
      call = await Call.findById(callId).select('status active startTime');
    }
    if (!call) {
      return res.json({ 
        success: true, 
        status: 'ended', 
        active: false,
        message: "Call record not found" 
      });
    }

    // 4. Return the actual state
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

app.get('/api/calls/history/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    const agentId = req.user.id;

    // Find calls where this agent is either the caller or receiver
    // We populate the 'receiver' or 'caller' to get the other person's name/photo
    const calls = await Call.find({
      $or: [
        { caller: agentId },
        { receiver: agentId }
      ]
    })
    .sort({ createdAt: -1 }) // Newest first
    .limit(50) // Limit to last 50 calls for performance
    .lean();
    const formattedCalls = await Promise.all(calls.map(async (call) => {
      const isCaller = call.caller.toString() === agentId;
            let participantData;
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
            _id: { $dayOfWeek: "$subscriptionDate" }, // Returns 1 (Sun) to 7 (Sat)
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
    
    // --- 1. SILENT EXPIRATION SYNC ---
    // Note: Since we are using .lean(), if we need to update status, we do it via updateOne
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

    // --- 2. SECURE PHOTO SIGNING (S3) ---
    // Using the robust extraction logic to handle the IDrive e2 private URL
    let finalPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        // Use the helper we defined earlier or the manual block:
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

    // Default Avatar Fallback
    if (!finalPhotoUrl) {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;
    }

    // --- 3. STATUS CALCULATION ---
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
        
        // --- Subscription Data ---
        plan: agent.plan || "BASIC",
        isSubscribed: !!agent.isSubscribed, 
        subscriptionDate: agent.subscriptionDate,
        expiryDate: agent.expiryDate,
        subscriptionAmount: agent.subscriptionAmount || 0,
        
        // --- Voice & Masking ---
        voiceId: agent.voiceId, 
        unlockedVoiceIds: agent.unlockedVoiceIds || [], 
        voiceDisplayName: agent.voiceDisplayName || "Natural Voice",
        voicePackageActive: !!agent.voicePackageActive, 
        voicePackageExpiry: agent.voicePackageExpiry,
        voiceMaskingEnabled: !!agent.voiceMaskingEnabled,
        
        // --- Status ---
        isVerified: !!agent.isVerified,
        status: isOnline ? 'online' : 'offline',
        lastActive: agent.lastActive,
        createdAt: agent.createdAt,
        
        // Metadata from your data dump
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

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`--- LOCAL SERVER ACTIVE ON PORT ${PORT} ---`);
  });
}

export default app;