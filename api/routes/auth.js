import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs'; // Add this
import { agentSchema } from '../models/Agent.js';
import mongoose from 'mongoose';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const getAgentModel = () => {
  return mongoose.models.Agent || mongoose.model('Agent', agentSchema);
};

router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const Agent = getAgentModel();

    const {
      firstName, lastName, email, password, address,
      occupation, program, bio, dob, gender, plan
    } = req.body;

    // 1. SECURITY: Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 2. SLUG GENERATION
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

    // 3. PHOTO HANDLING (Optional: Move S3 logic here if needed)
    let savedPhotoPath = ""; 
    // If you need S3 here, copy the s3Client.send logic from index.js

    // 4. CREATE AGENT
    const newAgent = new Agent({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword, // Use the hashed version!
      address,
      occupation,
      program: program || "N/A",
      bio: bio || "",
      dob,
      gender,
      slug: finalSlug,
      photoUrl: savedPhotoPath, 
      plan: plan || 'BASIC',
      role: 'agent',
      status: 'active',
      isSubscribed: false 
    });

    await newAgent.save();

    res.status(201).json({ 
      success: true,
      message: "Agent profile created successfully!", 
      slug: finalSlug
    });
    
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(error.code === 11000 ? 400 : 500).json({
      success: false,
      message: error.code === 11000 ? "Email already exists" : "Internal Server Error"
    });
  }
});

export default router;