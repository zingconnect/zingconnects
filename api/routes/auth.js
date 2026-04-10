import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import Flutterwave from 'flutterwave-node-v3';
import axios from 'axios';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { agentSchema } from '../models/Agent.js';
import User from '../models/User.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const flw = new Flutterwave(process.env.VITE_FLW_PUBLIC_KEY, process.env.VITE_FLW_SECRET_KEY);

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
    req.user = user; // Contains id and slug
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

// --- 1. AGENT REGISTRATION ---
router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const Agent = getAgentModel();
    const { firstName, lastName, email, password, address, occupation, program, bio, dob, gender, plan } = req.body;

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const baseSlug = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    let finalSlug = baseSlug;
    let counter = 1;
    while (await Agent.findOne({ slug: finalSlug })) {
      counter++;
      finalSlug = `${baseSlug}-${counter.toString().padStart(2, '0')}`;
    }

    let savedPhotoPath = ""; 
    if (req.file) {
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
    }

    const newAgent = new Agent({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      address,
      occupation,
      program: program || "N/A",
      bio: bio || "",
      dob,
      gender,
      slug: finalSlug,
      photoUrl: savedPhotoPath,
      plan: plan || 'BASIC',
      isSubscribed: false,
      role: 'agent'
    });

    await newAgent.save();
    res.status(201).json({ success: true, slug: finalSlug });
    
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(error.code === 11000 ? 400 : 500).json({
      success: false,
      message: error.code === 11000 ? "Email already exists" : "Registration failed"
    });
  }
});

// --- 2. AGENT LOGIN ---
router.post('/login', async (req, res) => {
  try {
    const Agent = getAgentModel();
    const { email, password } = req.body;
    const agent = await Agent.findOne({ 
      email: email.toLowerCase().trim() 
    }).select('+password');
    
    if (!agent) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

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
    console.error("Login API Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// --- 3. GET AGENT PROFILE (WITH AUTO-LOCK LOGIC) ---
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const Agent = getAgentModel();
    let agent = await Agent.findById(req.user.id).select('-password');
    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    // SUBSCRIPTION EXPIRY CHECK
    // If current date > expiryDate, set isSubscribed to false immediately
    if (agent.isSubscribed && agent.expiryDate && new Date() > new Date(agent.expiryDate)) {
      console.log(`Auto-locking dashboard for ${agent.email}: Plan Expired.`);
      agent.isSubscribed = false;
      await agent.save();
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ success: false, message: "Profile fetch error" });
  }
});

router.get('/profile/me', authenticateToken, async (req, res) => {
  try {
    const Agent = getAgentModel();
    // Use req.user.id (from your authenticateToken middleware)
    let agent = await Agent.findById(req.user.id).select('-password');
    
    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    // --- START SIGNING LOGIC ---
    let finalPhotoUrl = agent.photoUrl;

    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        // 1. Extract the key (e.g. "profiles/1775740964828-AGENT.png")
        // We split by '.com/' and take the second part
        const fileKey = agent.photoUrl.split('.com/')[1];

        if (fileKey) {
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: fileKey,
          });

          // 2. Generate the temporary signed URL (valid for 3600 seconds / 1 hour)
          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (signErr) {
        console.error("Signing Error:", signErr);
        // Fallback to static URL if signing fails
      }
    }
    // --- END SIGNING LOGIC ---

    res.json({
      success: true,
      firstName: agent.firstName,
      lastName: agent.lastName,
      occupation: agent.occupation,
      program: agent.program,
      bio: agent.bio,
      address: agent.address,
      photoUrl: finalPhotoUrl, // NOW INCLUDES THE SIGNATURE!
      slug: agent.slug,
      plan: agent.plan,
      isSubscribed: agent.isSubscribed,
      subscriptionAmount: agent.subscriptionAmount || 0,
      subscriptionDate: agent.subscriptionDate,
      expiryDate: agent.expiryDate
    });

  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ success: false, message: "Profile fetch error" });
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
    
    // 1. Prepare the base update object
    const updateData = {
      firstName,
      lastName,
      dob,
      city,
      state,
      isProfileComplete: true,
      isVerified: true
    };

    // 2. Handle IDrive e2 Upload if a file exists
    if (req.file) {
      // Create a unique key for the user's photo
      const fileKey = `users/${req.user.id}-${Date.now()}-${req.file.originalname}`;
      
      const uploadParams = {
        Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
        Key: fileKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };

      // Send the file to IDrive
      await s3Client.send(new PutObjectCommand(uploadParams));
      
      // Save the URL/Key in the database
      // You will use GetObjectCommand in my-session to sign this later
      updateData.photoUrl = `https://${process.env.IDRIVE_BUCKET_NAME}.idrivee2.com/${fileKey}`;
      
      console.log("User photo uploaded to IDrive:", fileKey);
    }

    // 3. Update the Database using the ID from the Token
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id, 
      updateData,
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error("User Onboarding Error:", err);
    res.status(500).json({ success: false, message: "Failed to save profile" });
  }
});


export default router;