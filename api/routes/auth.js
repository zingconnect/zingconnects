import express from 'express';
import mongoose from 'mongoose';
import { agentSchema } from '../models/Agent.js';

const router = express.Router();

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
      photoUrl // Received from the upload logic in index.js or passed in body
    } = req.body;

    const baseSlug = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    let finalSlug = baseSlug;
    let counter = 1;

    // 2. Recursive Check for Uniqueness
    let slugExists = await Agent.findOne({ slug: finalSlug });

    while (slugExists) {
      counter++;
      // Format as -02, -03, etc.
      const suffix = counter < 10 ? `-0${counter}` : `-${counter}`;
      finalSlug = `${baseSlug}${suffix}`;
      slugExists = await Agent.findOne({ slug: finalSlug });
    }

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
      photoUrl: photoUrl || ""
    });

    await newAgent.save();

    res.status(201).json({ 
      success: true,
      message: "Agent profile created successfully!", 
      slug: newAgent.slug 
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({
      success: false,
      message: error.code === 11000 ? "Email or Slug already exists" : error.message
    });
  }
});

export default router;