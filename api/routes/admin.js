import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"; // Ensure this is imported
import { GetObjectCommand } from "@aws-sdk/client-s3"; // Ensure this is imported
import Admin from '../models/Admin.js';
import Agent from '../models/Agent.js'; 
import { authenticateToken, isAdmin } from './auth.js';
import { connectToDatabase, s3Client } from '../index.js'; // Import s3Client from your main file

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    await connectToDatabase();

    // 1. Extract email instead of just username
    const { firstName, lastName, email, password, role } = req.body;

    // 2. Validation: Include email in the check
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Required fields are missing" 
      });
    }

    // 3. Check for existing admin using the email field
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existingAdmin) {
      return res.status(400).json({ 
        success: false, 
        message: "Email already registered" 
      });
    }

    // 4. Create new admin with the email field
    const newAdmin = new Admin({
      firstName,
      lastName,
      email, // Matches your new schema
      password, 
      role: role || 'superadmin'
    });

    await newAdmin.save();

    res.status(201).json({ 
      success: true, 
      message: "Administrator account created successfully" 
    });

  } catch (err) {
    console.error("Admin Reg Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error creating admin account",
      details: err.message 
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    // 1. Ensure DB is connected before querying
    await connectToDatabase(); 

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid admin credentials" });
    }

    // 5. Generate JWT Token
    const token = jwt.sign(
      { 
        id: admin._id, 
        role: 'admin',
        firstName: admin.firstName 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // 6. Return success with token and admin info
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
    console.error("Admin Login Error:", err);
    res.status(500).json({ success: false, message: "Login error", details: err.message });
  }
});

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();

    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [totalAgents, pendingAgents, dailyRev, weeklyRev, monthlyRev, yearlyRev] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ status: 'pending' }),
      
      // Daily Revenue - Summing paymentDetails.amountNgn to capture real transactions
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ]),

      // Weekly Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ]),

      // Monthly Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ]),

      // Yearly Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfYear } } },
        { $group: { _id: null, total: { $sum: "$paymentDetails.amountNgn" } } }
      ])
    ]);

    const chartData = [
      { name: 'Mon', revenue: 10000 },
      { name: 'Tue', revenue: 15500 },
      { name: 'Wed', revenue: 12000 },
      { name: 'Thu', revenue: 25000 },
      { name: 'Fri', revenue: 32000 },
      { name: 'Sat', revenue: 28000 },
      { name: 'Sun', revenue: 45000 },
    ];

    res.json({
      success: true,
      totalAgents,
      pendingAgents,
      currency: "NGN",
      currencySymbol: "₦",
      revenue: {
        daily: dailyRev[0]?.total || 0,
        weekly: weeklyRev[0]?.total || 0,
        monthly: monthlyRev[0]?.total || 0,
        yearly: yearlyRev[0]?.total || 0
      },
      chartData
    });

  } catch (err) {
    console.error("Financial Stats Error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching system financial stats",
      details: err.message 
    });
  }
});
// 1. GET ALL AGENTS (List View)
router.get('/agents', authenticateToken, async (req, res) => {
  try {
    // Ensure the database is connected before proceeding
    await connectToDatabase();
    
    // Get the model dynamically if using your helper, or use the imported model
    const AgentModel = getAgentModel();

    // Use .lean() to return plain objects and avoid Mongoose document overhead
    const agents = await AgentModel.find({})
      .select('firstName lastName email program isVerified photoUrl createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const formattedAgents = agents.map(agent => ({
      _id: agent._id,
      firstName: agent.firstName || "N/A",
      lastName: agent.lastName || "",
      email: agent.email || "No Email",
      program: agent.program || "General",
      isVerified: !!agent.isVerified,
      photoUrl: agent.photoUrl || `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}`
    }));

    res.json({
      success: true,
      agents: formattedAgents
    });
  } catch (err) {
    console.error("Admin Router: List Fetch Error:", err.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch agent list" 
    });
  }
});
// 1. GET ALL AGENTS (Fixed getAgentModel error)
router.get('/agents', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Use the 'Agent' model imported at the top of the file
    const agents = await Agent.find({})
      .select('firstName lastName email program isVerified photoUrl createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const formattedAgents = agents.map(agent => ({
      _id: agent._id,
      firstName: agent.firstName || "N/A",
      lastName: agent.lastName || "",
      email: agent.email || "No Email",
      program: agent.program || "General",
      isVerified: !!agent.isVerified,
      photoUrl: agent.photoUrl || `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}`
    }));

    res.json({ success: true, agents: formattedAgents });
  } catch (err) {
    console.error("Admin Router List Error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch agent list" });
  }
});

// 2. GET SINGLE AGENT (Fixed dependencies and model)
router.get('/agents/:id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Using Agent directly
    const agent = await Agent.findById(req.params.id);

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const now = new Date();
    let needsSave = false;

    // Silent Expiration Sync
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      needsSave = true;
    }
    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
      agent.voicePackageActive = false;
      needsSave = true;
    }
    if (needsSave) await agent.save();

    // Secure Photo Signing
    let finalPhotoUrl = agent.photoUrl;
    if (agent.photoUrl && agent.photoUrl.includes('idrivee2.com')) {
      try {
        const parts = agent.photoUrl.split('idrivee2.com/');
        const fileKey = parts[1];
        
        if (fileKey && typeof GetObjectCommand !== 'undefined' && s3Client) {
          const command = new GetObjectCommand({
            Bucket: process.env.IDRIVE_BUCKET_NAME || "livechat",
            Key: decodeURIComponent(fileKey),
          });
          finalPhotoUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        }
      } catch (signErr) {
        console.error("Signing Failed:", signErr.message);
      }
    }

    if (!finalPhotoUrl) {
      finalPhotoUrl = `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}`;
    }

    const isOnline = (now - new Date(agent.lastActive || agent.createdAt)) < 120000;

    res.json({
      success: true,
      agent: {
        ...agent.toObject(),
        photoUrl: finalPhotoUrl,
        status: isOnline ? 'online' : 'offline'
      }
    });
  } catch (err) {
    console.error("Admin Router Detail Error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;