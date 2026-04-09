import express from 'express';
import mongoose from 'mongoose';
import { agentSchema } from '../models/Agent.js';

const router = express.Router();

// --- FIXED MODEL INITIALIZATION ---
// This safely checks if the model exists on the connection or creates it
const getAgentModel = () => {
  // Use the connection established in index.js
  const db = mongoose.connection.useDb('zingconnect');
  return db.models.Agent || db.model('Agent', agentSchema);
};

router.post('/register', async (req, res) => {
  try {
    // Check if we are connected to MongoDB
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: "Database connecting... please try again." });
    }

    const Agent = getAgentModel();

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
      photoUrl
    } = req.body;

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

    // --- 2. CREATE AGENT WITH SUBSCRIPTION LOCK ---
    const newAgent = new Agent({
      firstName,
      lastName,
      email,
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
      photoUrl: photoUrl || "",
      status: 'active',
      isSubscribed: false // Explicitly false as per your requirement
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