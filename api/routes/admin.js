import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Agent from './models/Agent.js';
import { authenticateToken, isAdmin } from './auth.js';
import { connectToDatabase } from '../index.js';

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

    // Define time boundaries for revenue calculation
    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Fetch Agent counts and aggregate Revenue data
    // Assuming 'subscriptionFee' is the field in your Agent model
    const [totalAgents, pendingAgents, dailyRev, weeklyRev, monthlyRev, yearlyRev] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ status: 'pending' }),
      
      // Daily Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: "$subscriptionFee" } } }
      ]),

      // Weekly Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: "$subscriptionFee" } } }
      ]),

      // Monthly Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$subscriptionFee" } } }
      ]),

      // Yearly Revenue
      Agent.aggregate([
        { $match: { status: 'active', updatedAt: { $gte: startOfYear } } },
        { $group: { _id: null, total: { $sum: "$subscriptionFee" } } }
      ])
    ]);

    // Data for the 'Revenue Growth Flow' chart
    // Replace this static array with a real aggregation if you have a Transactions collection
    const chartData = [
      { name: 'Mon', revenue: 400 },
      { name: 'Tue', revenue: 700 },
      { name: 'Wed', revenue: 500 },
      { name: 'Thu', revenue: 900 },
      { name: 'Fri', revenue: 1200 },
      { name: 'Sat', revenue: 1100 },
      { name: 'Sun', revenue: 1500 },
    ];

    res.json({
      success: true,
      totalAgents,
      pendingAgents,
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


export default router;