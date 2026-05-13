import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Agent from '../models/Agent.js';
import Call from '../models/Call.js';
import { authenticateToken, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// --- 1. ADMIN REGISTRATION (Create Account) ---
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const lowerEmail = email.toLowerCase().trim();

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: lowerEmail });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Admin email already exists" });
    }

    // Create Admin - The password hashing is handled by the pre-save hook in Admin.js
    const newAdmin = new Admin({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: lowerEmail,
      password, // Pre-save hook hashes this
      username: lowerEmail.split('@')[0] // Default username from email
    });

    await newAdmin.save();

    res.status(201).json({ 
      success: true, 
      message: "Administrator account created successfully" 
    });
  } catch (err) {
    console.error("Admin Reg Error:", err);
    res.status(500).json({ success: false, message: "Error creating admin account" });
  }
});

// --- 2. ADMIN LOGIN ---
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const lowerEmail = email.toLowerCase().trim();

    // Find admin and include password for comparison
    const admin = await Admin.findOne({ email: lowerEmail });
    
    if (!admin) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Use the schema method to compare passwords
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    // Generate Token
    const token = jwt.sign(
      { id: admin._id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    res.json({
      success: true,
      token,
      admin: {
        id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email
      }
    });
  } catch (err) {
    console.error("Admin Login Error:", err);
    res.status(500).json({ success: false, message: "Server error during admin login" });
  }
});

// --- 3. SYSTEM STATS (Protected) ---
router.get('/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [totalAgents, pendingAgents, totalCallsToday] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ status: 'pending' }),
      Call.countDocuments({ 
        createdAt: { $gte: new Date().setHours(0,0,0,0) } 
      })
    ]);
    
    res.json({ success: true, totalAgents, pendingAgents, totalCallsToday });
  } catch (err) {
    res.status(500).json({ message: "Error fetching system stats" });
  }
});

// --- 4. AGENT MANAGEMENT (Protected) ---
router.patch('/agent-status/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const agent = await Agent.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json({ success: true, agent });
  } catch (err) {
    res.status(500).json({ message: "Failed to update agent status" });
  }
});

export default router;