import express from 'express';
import { Agent } from '../models/Agent.js';

const router = express.Router();

router.post('/register-agent', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Generate Slug: "John Doe" -> "john-doe"
    let slug = name.toLowerCase().split(' ').join('-');
    
    // Check if slug already exists (add random number if it does)
    const existingSlug = await Agent.findOne({ slug });
    if (existingSlug) {
      slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
    }

    const newAgent = new Agent({
      name,
      email,
      password, // Note: In production, hash this with bcrypt!
      slug,
      role
    });

    await newAgent.save();
    res.status(201).json({ message: "Agent created!", slug: newAgent.slug });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;