import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken'; // Added
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { agentSchema } from '../models/Agent.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const getAgentModel = () => {
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
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

    // Slug generation logic...
    const baseSlug = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    let finalSlug = baseSlug;
    let counter = 1;
    while (await Agent.findOne({ slug: finalSlug })) {
      counter++;
      finalSlug = `${baseSlug}-${counter.toString().padStart(2, '0')}`;
    }

    // Photo logic...
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

// --- 2. AGENT LOGIN (UPDATED) ---
router.post('/login', async (req, res) => {
  try {
    const Agent = getAgentModel();
    const { email, password } = req.body;

    // 1. Find agent and explicitly select password if hidden in schema
    const agent = await Agent.findOne({ email: email.toLowerCase().trim() });
    
    if (!agent) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // 2. Compare Password
    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // 3. Generate JWT with Role Security
    const token = jwt.sign(
      { id: agent._id, slug: agent.slug, role: 'agent' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      slug: agent.slug,
      role: 'agent' 
    });

  } catch (err) {
    console.error("Login API Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;