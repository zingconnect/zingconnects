import express from 'express';
import { Agent } from '../models/Agent.js';

const router = express.Router();

router.post('/register-agent', async (req, res) => {
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
      selectedPlan 
    } = req.body;

    const fullName = `${firstName} ${lastName}`;

    // 1. Generate Base Slug: "John Doe" -> "john-doe"
    let slug = `${firstName}-${lastName}`.toLowerCase().replace(/\s+/g, '-');
    
    // 2. Collision Check: Ensure slug is unique
    const existingAgent = await Agent.findOne({ slug });
    if (existingAgent) {
      slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // 3. Create New Agent with all information
    const newAgent = new Agent({
      firstName,
      lastName,
      name: fullName, // Optional helper field
      email,
      password, // REMINDER: Use bcrypt.hash(password, 10) here!
      address,
      occupation,
      program: program || "N/A",
      bio,
      dob,
      gender,
      slug,
      plan: selectedPlan?.tier || 'BASIC',
      role: 'agent'
    });

    await newAgent.save();

    res.status(201).json({ 
      success: true,
      message: "Agent profile created successfully!", 
      slug: newAgent.slug 
    });

  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;