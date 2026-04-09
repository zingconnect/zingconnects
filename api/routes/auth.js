import express from 'express';
import mongoose from 'mongoose';
import { agentSchema } from '../models/Agent.js';

const router = express.Router();

// Ensure we are using the correct database instance
const agentDb = mongoose.connection.useDb('zingconnect'); 
const Agent = agentDb.models.Agent || agentDb.model('Agent', agentSchema);

router.post('/register', async (req, res) => {
  try {
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
      plan,
      photoUrl // This is the static path passed from your upload middleware
    } = req.body;

    // --- 1. SLUG GENERATION ---
    // Improved regex to ensure no special characters break the root URL
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

    // --- 2. CREATE AGENT WITH SUBSCRIPTION LOCK ---
    const newAgent = new Agent({
      firstName,
      lastName,
      email,
      password, // Note: Ensure you are hashing this if not using a pre-save hook
      address,
      occupation,
      program: program || "N/A",
      bio: bio || "",
      dob,
      gender,
      slug: finalSlug,
      plan: plan || 'BASIC',
      role: 'agent',
      photoUrl: photoUrl || "",
      
      status: 'active',      // Account is created and can log in
      isSubscribed: false    // Must remain false until dashboard payment is made
    });

    await newAgent.save();

    res.status(201).json({ 
      success: true,
      message: "Agent profile created successfully!", 
      slug: finalSlug,
      isSubscribed: false 
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