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
plan
} = req.body;

let slug = `${firstName}-${lastName}`.toLowerCase().trim().replace(/\s+/g, '-');

const existingAgent = await Agent.findOne({ slug });
if (existingAgent) {
  slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
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
  slug,
  plan: plan || 'BASIC',
  role: 'agent'
});

await newAgent.save();

res.status(201).json({ 
  success: true,
  message: "Agent profile created successfully!", 
  slug: newAgent.slug 
});
} catch (error) {
res.status(500).json({
success: false,
message: error.code === 11000 ? "Email already exists" : error.message
});
}
});

export default router;