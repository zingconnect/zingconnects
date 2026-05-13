import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import Admin from '../models/Admin.js';
import Agent from '../models/Agent.js'; 
import { authenticateToken, isAdmin } from './auth.js';
// Import the shared client and DB helper from your index.js
import { connectToDatabase, s3Client } from '../index.js'; 

const router = express.Router();

/**
 * @route   POST /api/admin/register
 * @desc    Create a new administrator
 */
router.post('/register', async (req, res) => {
  try {
    await connectToDatabase();
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "Required fields are missing" });
    }

    const lowerEmail = email.toLowerCase().trim();
    const existingAdmin = await Admin.findOne({ email: lowerEmail });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    const newAdmin = new Admin({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: lowerEmail,
      password, // Your Admin schema middleware should handle hashing
      role: role || 'superadmin'
    });

    await newAdmin.save();
    res.status(201).json({ success: true, message: "Administrator account created successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error creating admin account", details: err.message });
  }
});

/**
 * @route   POST /api/admin/login
 * @desc    Admin authentication & token generation
 */
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

    // Explicitly set role: 'admin' for the isAdmin middleware to function
    const token = jwt.sign(
      { id: admin._id, role: 'admin', firstName: admin.firstName },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      token, 
      admin: { 
        id: admin._id, 
        firstName: admin.firstName, 
        lastName: admin.lastName, 
        role: admin.role 
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Login error", details: err.message });
  }
});

/**
 * @route   GET /api/admin/stats
 * @desc    Fetch system-wide statistics (SECURE)
 */
router.get('/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalAgents, pendingAgents, dailyRev, weeklyRev, monthlyRev] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ isVerified: false }),
      // Daily Revenue
      Agent.aggregate([
        { $match: { isSubscribed: true, updatedAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ]),
      // Weekly Revenue
      Agent.aggregate([
        { $match: { isSubscribed: true, updatedAt: { $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ]),
      // Monthly Revenue
      Agent.aggregate([
        { $match: { isSubscribed: true, updatedAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ])
    ]);

    res.json({
      success: true,
      totalAgents,
      pendingAgents,
      currency: "NGN",
      revenue: { 
        daily: dailyRev[0]?.total || 0,
        weekly: weeklyRev[0]?.total || 0,
        monthly: monthlyRev[0]?.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching stats", details: err.message });
  }
});

/**
 * @route   GET /api/admin/agents
 * @desc    List all registered agents (SECURE)
 */
router.get('/agents', authenticateToken, isAdmin, async (req, res) => {
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

/**
 * @route   GET /api/admin/agents/:id
 * @desc    Fetch detailed profile for a single agent (SECURE)
 */
router.get('/agents/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const agent = await Agent.findById(req.params.id);

    if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

    // --- SECURE PHOTO SIGNING ---
    let finalPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com') && s3Client) {
      try {
        const urlParts = agent.photoUrl.split('/');
        const profileIndex = urlParts.indexOf('profiles');
        
        if (profileIndex !== -1) {
          const fileKey = urlParts.slice(profileIndex).join('/');
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: decodeURIComponent(fileKey),
          });
          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
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