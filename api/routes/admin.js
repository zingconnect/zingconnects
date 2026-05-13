import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Agent from '../models/Agent.js';
import Call from '../models/Call.js';
import { authenticateToken, isAdmin } from './auth.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }
    const lowerEmail = email.toLowerCase().trim();
    const existingAdmin = await Admin.findOne({ email: lowerEmail });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: "Admin email already exists" });
    }
    const newAdmin = new Admin({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: lowerEmail,
      password // Hashed by Admin.js pre-save hook
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

// --- ADMIN LOGIN ---
// Endpoint: POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid admin credentials" });
    }

    const token = jwt.sign(
      { id: admin._id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ success: true, token, admin: { name: admin.firstName, role: admin.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Login error" });
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