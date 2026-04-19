import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { connectToDatabase } from '../index.js';
import { agentSchema } from '../models/Agent.js';
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

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Access Denied: No Token Provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Session Expired" });
    req.user = user;
    next();
  });
};

// --- IDRIVE E2 CONFIG ---
const s3Client = new S3Client({
  region: process.env.IDRIVE_REGION,
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
  },
});

// --- 1. STAGE 1: AGENT REGISTRATION (INIT) ---
router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    // CRITICAL: Ensure DB is connected before any operation
    await connectToDatabase();
    
    const Agent = getAgentModel();
    const { 
      firstName, lastName, email, password, address, 
      occupation, program, bio, dob, gender, plan 
    } = req.body;

    const lowerEmail = email.toLowerCase().trim();

    // 1. CHECK IF EMAIL EXISTS & VERIFICATION STATUS
    let existingAgent = await Agent.findOne({ email: lowerEmail });

    if (existingAgent && existingAgent.isVerified) {
      // If the account is already verified, block registration
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered. Please login." 
      });
    }

    // 2. PASSWORD HASHING
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. SLUG GENERATION (Only for new agents)
    let finalSlug = existingAgent ? existingAgent.slug : "";
    if (!existingAgent) {
      const baseSlug = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      finalSlug = baseSlug;
      let counter = 1;
      while (await Agent.findOne({ slug: finalSlug })) {
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
        
        await s3Client.send(new PutObjectCommand({
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
      // UPDATE existing unverified agent
      existingAgent.firstName = firstName.trim();
      existingAgent.lastName = lastName.trim();
      existingAgent.password = hashedPassword;
      existingAgent.address = address || "";
      existingAgent.occupation = occupation || "";
      existingAgent.program = program || "";
      existingAgent.bio = bio || "";
      existingAgent.dob = dob;
      existingAgent.gender = gender;
      existingAgent.photoUrl = savedPhotoPath;
      existingAgent.otp = otpCode;
      existingAgent.otpExpires = otpExpiry;
      existingAgent.plan = plan || 'BASIC';
      
      await existingAgent.save();
      console.log("Existing unverified agent updated with new OTP.");
    } else {
      // CREATE brand new agent
      const newAgent = new Agent({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
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


const logoPath = path.join(process.cwd(), 'public', 'logo.png');

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

    // 8. FINAL RESPONSE
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
    const Agent = getAgentModel();
    const agent = await Agent.findOne({ 
      email: email.toLowerCase().trim(),
      otp: otp,
      otpExpires: { $gt: Date.now() }
    });

    if (!agent) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

    agent.isVerified = true;
    agent.status = 'active';
    agent.otp = undefined;
    agent.otpExpires = undefined;
    await agent.save();

    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ success: true, token, slug: agent.slug });
  } catch (err) {
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});

// --- 3. AGENT LOGIN ---
router.post('/login', async (req, res) => {
  try {
    const Agent = getAgentModel();
    const { email, password } = req.body;
    const agent = await Agent.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!agent) return res.status(401).json({ success: false, message: "Invalid credentials" });
    
    // Check if verified
    if (!agent.isVerified) return res.status(403).json({ success: false, message: "Please verify your email first" });

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' }, 
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
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- 3. GET AGENT PROFILE ---
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // 2. Get the model safely
    const Agent = getAgentModel();

    let agent = await Agent.findById(req.user.id).select('-password');
    
    if (!agent) {
      console.error(`Agent ID ${req.user.id} not found.`);
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const now = new Date();
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      console.log(`Auto-locking: Plan expired for ${agent.email}`);
      agent.isSubscribed = false;
      await agent.save();
    }
    agent.lastActive = now;
    await agent.save();
    res.json(agent);

  } catch (err) {
    // This catches the error that was causing your 500
    console.error("DETAILED PROFILE ERROR:", err);
    res.status(500).json({ 
      success: false, 
      message: "Profile fetch error", 
      error: err.message 
    });
  }
});


router.get('/profile/me', authenticateToken, async (req, res) => {
  try {
    // 1. Ensure Database is connected
    await connectToDatabase();
    
    const Agent = getAgentModel();
    // Use .lean() to get a plain JS object, making it easier to modify properties
    const agent = await Agent.findById(req.user.id).select('-password').lean();
    
    if (!agent) {
      return res.status(404).json({ 
        success: false, 
        message: "Agent not found" 
      });
    }
    let finalPhotoUrl = agent.photoUrl;

    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        const urlParts = agent.photoUrl.split('/');
        const profileIndex = urlParts.indexOf('profiles');
        
        if (profileIndex !== -1) {
          const fileKey = urlParts.slice(profileIndex).join('/');

          if (s3Client) {
            const command = new GetObjectCommand({
              Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
              Key: decodeURIComponent(fileKey), // Decode in case the DB stored it encoded
            });
            finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
          }
        }
      } catch (signErr) {
        console.error("Image Signing Failed:", signErr.message);
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
      photoUrl: finalPhotoUrl || "",
      slug: agent.slug || "",
      plan: agent.plan || "BASIC",
      isSubscribed: !!agent.isSubscribed,
      subscriptionAmount: agent.subscriptionAmount || 0,
      subscriptionDate: agent.subscriptionDate,
      expiryDate: agent.expiryDate
    });

  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});
// --- 4. UPDATE AGENT PLAN ---
router.post('/update-plan', authenticateToken, async (req, res) => {
  try {
    const Agent = getAgentModel();
    const { plan } = req.body;
    const updatedAgent = await Agent.findByIdAndUpdate(
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
  const Agent = getAgentModel();

  try {
    // 1. USE FIXED RATE FROM .ENV
    // We use Number() to ensure it's a digit and 1550 as a hard fallback
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

        const updatedAgent = await Agent.findByIdAndUpdate(
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

// --- 6. UPDATE AGENT PROFILE & SECURITY (FIXED) ---
router.put('/update-profile', authenticateToken, async (req, res) => {
  try {
    const Agent = getAgentModel();
    
    // 1. Find the Agent Document
    const agent = await Agent.findById(req.user.id).select('+password');
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
      oldPassword, 
      newPassword 
    } = req.body;

    // 3. Handle Password Security Update (Only if newPassword is provided)
    if (newPassword && newPassword.trim() !== "") {
      // If updating password, old password must be provided for verification
      if (!oldPassword) {
        return res.status(400).json({ 
          success: false, 
          message: "Current password is required to authorize security changes." 
        });
      }

      // Verify the old password matches the database
      const isMatch = await bcrypt.compare(oldPassword, agent.password);
      if (!isMatch) {
        return res.status(401).json({ 
          success: false, 
          message: "Current password incorrect. Security sync blocked." 
        });
      }

      // Hash the new password before saving
      const salt = await bcrypt.genSalt(10);
      agent.password = await bcrypt.hash(newPassword, salt);
    }

    // 4. Update Profile Information
    agent.firstName = firstName || agent.firstName;
    agent.lastName = lastName || agent.lastName;
    agent.occupation = occupation || agent.occupation;
    agent.program = program || agent.program;
    agent.bio = bio || agent.bio;
    agent.gender= gender || agent.gender;
  agent.dob = dob || agent.dob;
    agent.address = address || agent.address;

    // 5. Save the Document (triggers validation and updates timestamp)
    await agent.save();

    console.log(`[SECURITY] Identity & Credentials updated for: ${agent.email}`);
    
    // Create a clean object for the response (no password)
    const updatedAgent = agent.toObject();
    delete updatedAgent.password;

    res.json({
      success: true,
      message: "Identity and Security synchronized successfully across nodes.",
      agent: updatedAgent
    });

  } catch (err) {
    console.error("Update Profile Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Internal server error during profile sync",
      error: err.message 
    });
  }
});

router.put('/update-user-onboarding', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
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
      // 1. Sanitize the filename
      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const fileKey = `users/${req.user.id}-${Date.now()}-${sanitizedName}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      // 2. Execute upload to IDrive
      await s3Client.send(new PutObjectCommand(uploadParams));      
      updateData.photoUrl = fileKey; 
      
      console.log(`[Storage] Photo stored as key: ${fileKey}`);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id, 
      updateData,
      { new: true }
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
    console.error("ONBOARDING ERROR:", err);
    res.status(500).json({ success: false, message: "Server error during profile update" });
  }
});

router.get('/my-users', authenticateToken, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    await connectToDatabase();
    
    const agentId = req.user.id || req.user._id;

    if (!agentId) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid session metadata." 
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
          console.error(`[S3 Error] ${user.email}:`, s3Err.message);
        }
      }

      if (!finalPhotoUrl) {
        const fullName = `${user.firstName}+${user.lastName}`;
        finalPhotoUrl = `https://ui-avatars.com/api/?name=${fullName}&background=random&color=fff&size=128`;
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
    console.error("CRITICAL USER FETCH ERROR:", err);
    res.status(500).json({ 
      success: false, 
      message: "System failed to sync user list",
      error: err.message
    });
  }
});

export default router;