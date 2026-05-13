import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import Admin from '../models/Admin.js';
import Agent from '../models/Agent.js'; 
import { authenticateToken, isAdmin } from './auth.js';
// Import the shared client and DB helper
import { connectToDatabase, s3Client } from '../index.js'; 

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    await connectToDatabase();
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "Required fields are missing" });
    }

    const existingAdmin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    const newAdmin = new Admin({
      firstName,
      lastName,
      email: email.toLowerCase().trim(),
      password, 
      role: role || 'superadmin'
    });

    await newAdmin.save();
    res.status(201).json({ success: true, message: "Administrator account created successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error creating admin account", details: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    await connectToDatabase(); 
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid admin credentials" });
    }

    const token = jwt.sign(
      { id: admin._id, role: 'admin', firstName: admin.firstName },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      admin: { id: admin._id, firstName: admin.firstName, lastName: admin.lastName, role: admin.role } 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Login error", details: err.message });
  }
});

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));

    // Using the imported 'Agent' model directly
    const [totalAgents, pendingAgents, dailyRev] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ isVerified: false }),
      Agent.aggregate([
        { $match: { isSubscribed: true, updatedAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ])
    ]);

    res.json({
      success: true,
      totalAgents,
      pendingAgents,
      revenue: { daily: dailyRev[0]?.total || 0 }
      // Add weekly/monthly/yearly logic similar to dailyRev
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching stats", details: err.message });
  }
});

// GET ALL AGENTS
router.get('/agents', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const agents = await Agent.find({})
      .select('firstName lastName email program isVerified photoUrl createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const formattedAgents = agents.map(agent => ({
      ...agent,
      photoUrl: agent.photoUrl || `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}`
    }));

    res.json({ success: true, agents: formattedAgents });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch agent list" });
  }
});

// GET SINGLE AGENT
router.get('/agents/:id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const agent = await Agent.findById(req.params.id);

    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    // Handle S3 Signed URL for the specific agent photo
    let finalPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com') && s3Client) {
      try {
        const fileKey = agent.photoUrl.split('idrivee2.com/')[1];
        const command = new GetObjectCommand({
          Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
          Key: decodeURIComponent(fileKey),
        });
        finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
      } catch (signErr) {
        console.error("Photo Signing Error:", signErr.message);
      }
    }

    res.json({
      success: true,
      agent: {
        ...agent.toObject(),
        photoUrl: finalPhotoUrl || `https://ui-avatars.com/api/?name=${agent.firstName}`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;