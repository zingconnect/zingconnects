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
import nodemailer from 'nodemailer';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fileURLToPath } from 'url';
import Agent from './models/Agent.js';
import User from './models/User.js'; 
import Message from './models/Message.js';
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/message.js'; 
import webpush from 'web-push';
import { Server } from 'socket.io';
import http from 'http';
import callRoutes from './routes/callRoutes.js';

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

webpush.setVapidDetails(
`mailto:${process.env.VITE_EMAIL}`,
  process.env.VITE_PUBLIC_KEY, 
  process.env.VITE_PRIVATE_KEY
);

const getPrivateUrl = async (fileKey) => {
  try {
    if (!fileKey) return null;

    let actualKey = fileKey;
        if (fileKey.startsWith('http')) {
      const parts = fileKey.split('.com/');
      actualKey = parts.length > 1 ? parts[1] : fileKey;
            actualKey = actualKey.split('?')[0];
    }

    const command = new GetObjectCommand({
      Bucket: process.env.IDRIVE_BUCKET_NAME,
      Key: actualKey,
    });

    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  } catch (err) {
    console.error("Signing error:", err);
    return null;
  }
};


let cachedDb = null;

export async function connectToDatabase() {
    if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
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


const getAgentModel = () => {
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: "Access Denied" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Invalid Token" });
    }
    if (decoded.role === 'agent') {
      try {
        const agent = await Agent.findById(decoded.id).select('currentSessionId lastActive');

        if (!agent || agent.currentSessionId !== decoded.sessionId) {
          console.log(`AUTH FAIL - Session Mismatch for Agent: ${decoded.id}`);
          return res.status(401).json({ 
            success: false, 
            message: "Account logged in from another device.",
            forceLogout: true // Signal for frontend to clear storage
          });
        }
        agent.lastActive = new Date();
        await agent.save();

     } catch (dbErr) {
  console.error("DATABASE AUTH ERROR:", dbErr); // <--- Add this!
  return res.status(500).json({ message: "Internal Auth Error", error: dbErr.message });
}
    }

    // 3. Attach user to request and move forward
    req.user = decoded;
    next();
  });
};
let ioInstance; 

ioInstance = io; 

io.on("connection", (socket) => {
  console.log("Socket Connected:", socket.id);
  socket.on("join-main-room", (userId) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`User ${userId} is now reachable in their private room.`);
    }
  });
  socket.on("call-user", ({ userToCall, signalData, fromId, fromName, callId }) => {
    console.log(`Relaying Offer from ${fromName} to ${userToCall}`);
    io.to(userToCall.toString()).emit("incoming-call", { 
      signal: signalData, 
      fromId, 
      fromName, 
      callId 
    });
  });
  socket.on("confirm-ringing", ({ to }) => {
    if (to) io.to(to.toString()).emit("user-is-ringing");
  });
  socket.on("answer-call", ({ to, signal, callId }) => {
    console.log(`Relaying Answer for Call: ${callId} back to Initiator: ${to}`);
    io.to(to.toString()).emit("call-accepted", { 
      signal, 
      callId 
    });
  });
  socket.on("end-call", ({ to }) => {
    if (to) {
      console.log(`Ending call for user: ${to}`);
      io.to(to.toString()).emit("call-ended");
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

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
                // We continue even if upload fails so registration isn't blocked
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

    // Use the helper we just defined above
    const AgentModel = getAgentModel();
    
    let agent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { lastActive: new Date() }, 
      { returnDocument: 'after' } 
    ).select('-password'); 

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      await agent.save(); 
    }

    const lastActiveDate = agent.lastActive || agent.createdAt;
    const isOnline = (now - new Date(lastActiveDate)) < (120000);

    let signedPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        const fileKey = agent.photoUrl.split('.com/')[1];
        if (fileKey && s3Client) {
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: decodeURIComponent(fileKey),
          });
          signedPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (s3Err) {
        console.error("IDrive Signing Error:", s3Err.message);
      }
    }

    if (!signedPhotoUrl) {
      signedPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=random&color=fff&size=128`;
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
      expiryDate: agent.expiryDate,
      status: isOnline ? 'online' : 'offline',
      lastActive: agent.lastActive
    }); 

  } catch (err) {
    console.error("FULL DEBUG ERROR:", err.stack);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// --- AGENT HEARTBEAT PULSE ---
app.post('/api/agents/heartbeat', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const AgentModel = getAgentModel(); // Ensure consistency with your helper

    const updatedAgent = await AgentModel.findByIdAndUpdate(
      req.user.id, 
      { lastActive: new Date() }, 
      { new: true, select: 'lastActive' } 
    );

    if (!updatedAgent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

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

app.get('/api/users/my-session', async (req, res) => {
  try {
    await connectToDatabase();
    
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "No token" });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 1. Update user presence and populate agents
    // Using 'returnDocument' fixes the Mongoose deprecation warning
    const user = await User.findByIdAndUpdate(
      decoded.id, 
      { lastActive: new Date() },
      { returnDocument: 'after' } 
    ).populate({
      path: 'connectedAgents',
      select: 'firstName lastName photoUrl occupation program bio slug lastActive'
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    // 2. Identify the active agent
    let activeAgent = user.connectedAgents && user.connectedAgents.length > 0 
      ? user.connectedAgents[user.connectedAgents.length - 1] 
      : null;
    
    let isOnline = false;
    let lastSeenDisplay = "Offline";

    if (activeAgent) {
      // 3. Fetch fresh status from the Agent model
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
    console.log("--- Profile Request Start ---");
    console.log("Slug requested:", req.params.slug);
    
    await connectToDatabase();
    const AgentModel = getAgentModel(); 

    if (!AgentModel) {
      throw new Error("Agent model is not initialized");
    }

    const agent = await AgentModel.findOne({ slug: req.params.slug }).select('-password');
    
    if (!agent) {
      console.log("Profile not found in MongoDB for slug:", req.params.slug);
      return res.status(404).json({ message: "Agent not found" });
    }

    const agentObj = agent.toObject();

    if (agentObj.photoUrl && typeof agentObj.photoUrl === 'string' && agentObj.photoUrl.includes('profiles/')) {
      try {
        const urlParts = agentObj.photoUrl.split('profiles/');
        const fileName = urlParts[urlParts.length - 1].split('?')[0]; 
        const fileKey = `profiles/${fileName}`;

        console.log("Generating signed URL for:", fileKey);

        const getCommand = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME,
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

// GET current user's full profile data
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Find user and exclude sensitive fields like password if they existed
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // IDrive / S3 Image Signing Logic for User Photo
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

// --- UPDATED: GET CHAT MESSAGES WITH PAGINATION & SPEED ---
app.get('/api/messages/:otherUserId', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id;
    const { otherUserId } = req.params;
    
    // 1. ADD PAGINATION: Get 'limit' from query, default to 20
    const limit = parseInt(req.query.limit) || 20;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: myId }
      ]
    })
    .sort({ createdAt: -1 }) // 2. GET NEWEST FIRST
    .limit(limit)            // 3. ONLY GET THE LATEST 20
    .lean();

    const chronologicalMessages = messages.reverse();

    const signedMessages = await Promise.all(chronologicalMessages.map(async (m) => {
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
// --- 5. SEND MESSAGE ROUTE (WITH PUSH) ---
app.post('/api/messages/send', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, text, receiverModel } = req.body;

    // 1. Create and Save Message
    const newMessage = new Message({
      senderId: req.user.id,
      senderModel: req.user.role === 'agent' ? 'Agent' : 'User',
      receiverId,
      receiverModel,
      text,
      notificationSent: false // Ensure it starts as false
    });
    await newMessage.save();
    try {
      const TargetModel = receiverModel === 'Agent' ? Agent : User;
      const receiver = await TargetModel.findById(receiverId);

      if (receiver && receiver.pushSubscription) {
        const payload = JSON.stringify({
          title: `New Message from ${req.user.firstName || 'Zing'}`,
          body: text || "Sent an attachment",
          data: {
            url: receiverModel === 'Agent' ? '/agent-dashboard' : '/user-dashboard'
          }
        });
        await webpush.sendNotification(receiver.pushSubscription, payload);
        await Message.findByIdAndUpdate(newMessage._id, { notificationSent: true });
        newMessage.notificationSent = true;
        console.log(`[Push] Notification sent and logged for message: ${newMessage._id}`);
      }
    } catch (pushErr) {
      console.error("Push delivery failed, flag remains false:", pushErr.message);
    }
    res.status(201).json({ success: true, message: newMessage });
  } catch (err) {
    console.error("SEND MESSAGE ERROR:", err);
    res.status(500).json({ success: false, message: "Server failed to save message" });
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

app.post('/api/calls/start', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { receiverId, receiverModel } = req.body;
    
    const callerId = req.user.id || req.user._id || req.user.userId;
    if (!callerId) return res.status(401).json({ message: "Auth Error: No ID in token" });

    const callerModel = req.user.role === 'agent' ? 'Agent' : 'User';
    const finalReceiverModel = receiverModel || (callerModel === 'Agent' ? 'User' : 'Agent');
    const newCall = new Call({
      caller: callerId,
      callerModel: callerModel,
      receiver: receiverId,
      receiverModel: finalReceiverModel,
      status: 'calling',
      startTime: new Date()
    });

    await newCall.save();
    
    console.log(`🚀 Call DB Entry Created: ${callerId} (${callerModel}) -> ${receiverId}`);
    
    res.status(201).json({ 
      success: true, 
      callId: newCall._id,
      status: 'calling'
    });
  } catch (err) {
    console.error("❌ Start Call Backend Error:", err);
    res.status(500).json({ success: false, error: err.message });
  } 
});

app.get('/api/calls/check-incoming', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const rawId = req.user?._id || req.user?.id || req.user?.userId;
    if (!rawId) return res.status(401).json({ hasIncomingCall: false });

    // We look for 'calling' or 'ringing'. This ensures the user sees the call 
    // even if the status hasn't transitioned yet.
    let incoming = await Call.findOne({ 
      receiver: rawId,
      status: { $in: ['calling', 'ringing'] },
      active: true 
    })
    .sort({ createdAt: -1 })
    .populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });

    const callStartTime = new Date(incoming.createdAt).getTime();
    const now = Date.now();
    const diffInSeconds = (now - callStartTime) / 1000;

    // Ghost Protection
    if (diffInSeconds > 60) {
      incoming.status = 'missed';
      incoming.active = false;
      await incoming.save();
      return res.json({ hasIncomingCall: false });
    }

    // Auto-transition to ringing so the Agent knows the User's phone is active
    if (incoming.status === 'calling') {
      incoming.status = 'ringing';
      await incoming.save();
    }

    // Standardized response to match Frontend: activeCall.callerData.fromName
    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      status: incoming.status, 
      signal: incoming.signal, // This MUST be present for WebRTC to connect
      createdAt: incoming.createdAt,
      callerData: {
        fromName: incoming.caller 
          ? `${incoming.caller.firstName} ${incoming.caller.lastName}`.trim() 
          : "Secure Caller",
        photoUrl: incoming.caller?.photoUrl || null,
        callerId: incoming.caller?._id
      }
    });

  } catch (err) {
    console.error("Check-Incoming Error:", err);
    res.status(500).json({ hasIncomingCall: false });
  }
});

app.patch('/api/calls/update-signal', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const { callId, signal } = req.body;

    if (!callId || !signal) {
      return res.status(400).json({ success: false, message: "Missing callId or signal data" });
    }

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ success: false, message: "Call session not found" });
    }

    const isOffer = !call.signal;
    
    const updateData = isOffer 
      ? { signal, status: 'ringing' } 
      : { answerSignal: signal, status: 'connected', startTime: Date.now() };

    const updatedCall = await Call.findByIdAndUpdate(callId, updateData, { new: true });
    const io = req.app.get('socketio');
    if (io) {
      const myId = (req.user.id || req.user._id).toString();
      const targetId = updatedCall.caller.toString() === myId 
        ? updatedCall.receiver.toString() 
        : updatedCall.caller.toString();

      if (isOffer) {
        io.to(targetId).emit("incoming-call", {
          signal,
          fromId: myId,
          fromName: req.user.name || "User",
          callId
        });
      } else {
        io.to(targetId).emit("call-accepted", {
          signal,
          callId
        });
      }
    }

    res.json({ 
      success: true, 
      status: updatedCall.status,
      signalType: isOffer ? 'offer' : 'answer' 
    });
  } catch (err) {
    console.error("❌ Update Signal Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});
app.post('/api/calls/accept', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Support both body.callId or finding the latest via Token ID
    const myId = req.user.id || req.user._id || req.user.userId;
    const { callId } = req.body;

    let query = { 
      receiver: myId, 
      status: { $in: ['calling', 'ringing'] } 
    };

    // If specific callId provided, use it, otherwise find the latest ringing call
    if (callId) {
      query = { _id: callId, receiver: myId };
    }

    const call = await Call.findOneAndUpdate(
      query, 
      { 
        status: 'connected', 
        startTime: Date.now() 
      }, 
      { 
        new: true, 
        sort: { createdAt: -1 } 
      }
    ).populate('caller', 'firstName lastName photoUrl');

    if (!call) {
      return res.status(404).json({ 
        success: false, 
        message: "No active call found." 
      });
    }
    res.json({ 
      success: true, 
      call,
      signal: call.signal // Send the initiator's signal explicitly
    });

  } catch (err) {
    console.error("Accept Call Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: err.message 
    });
  }
});

// 4. Unified End/Cancel Call (Ends call if you are either the Caller OR Receiver)
app.post('/api/calls/end', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const myId = req.user.id || req.user._id || req.user.userId;

    // Find the active call associated with my ID in either slot
    const call = await Call.findOneAndUpdate(
      { 
        $or: [{ caller: myId }, { receiver: myId }],
        status: { $in: ['ringing', 'connected'] }
      },
      { status: 'ended', endTime: Date.now() },
      { new: true, sort: { createdAt: -1 } }
    );

    res.json({ success: true, message: "Call terminated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`--- SERVER ACTIVE ON PORT ${PORT} ---`);
});
export default app;