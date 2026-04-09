import express from 'express';
import multer from 'multer'; // 1. Import Multer
import { agentSchema } from '../models/Agent.js';
import mongoose from 'mongoose';

const router = express.Router();

// 2. Setup Multer for this router (Memory storage is best for Vercel)
const upload = multer({ storage: multer.memoryStorage() });

const getAgentModel = () => {
  // Use the connection state or a fallback
  // This ensures we aren't creating a new connection on every click
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
};

// 3. Add 'upload.none()' or 'upload.single('photo')' to parse the FormData
router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const Agent = getAgentModel();

    // Now req.body will actually contain your firstName, lastName, etc.
    const {
      firstName,
      lastName,
      email,
      password,
      address,
      occupation,
      program,
      bio,
      dob,
      gender,
      plan
    } = req.body;

    // Validation check
    if (!firstName || !email) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // --- 1. SLUG GENERATION ---
    const baseSlug = `${firstName}${lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();

    let finalSlug = baseSlug;
    let counter = 1;
    let slugExists = await Agent.findOne({ slug: finalSlug });

    while (slugExists) {
      counter++;
      const suffix = counter < 10 ? `-0${counter}` : `-${counter}`;
      finalSlug = `${baseSlug}${suffix}`;
      slugExists = await Agent.findOne({ slug: finalSlug });
    }

    // --- 2. CREATE AGENT ---
    const newAgent = new Agent({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password, 
      address,
      occupation,
      program: program || "N/A",
      bio: bio || "",
      dob,
      gender,
      slug: finalSlug,
      plan: plan || 'BASIC',
      role: 'agent',
      status: 'active',
      isSubscribed: false 
    });

    // NOTE: If you are handling the S3 upload in index.js, 
    // you need to make sure the photoUrl is passed correctly here.
    
    await newAgent.save();

    res.status(201).json({ 
      success: true,
      message: "Agent profile created successfully!", 
      slug: finalSlug
    });
    
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({
      success: false,
      message: error.code === 11000 ? "Email or User Link already exists" : error.message
    });
  }
});

export default router;