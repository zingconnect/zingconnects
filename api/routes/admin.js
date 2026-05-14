import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import Agent from '../models/Agent.js'; 
import { connectToDatabase } from '../config/db.js';
import { getPrivateUrl } from '../config/s3.js';
import { authenticateToken, isAdmin } from './auth.js';
import SupportMessage from '../models/Support.js';


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
 * @desc    Fetch system-wide statistics (FIXED: Added compatibility & null safety)
 */
router.get('/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    
    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalAgents, 
      pendingAgents, 
      dailyRev, 
      weeklyRev, 
      monthlyRev, 
      yearlyRev, 
      dynamicChart
    ] = await Promise.all([
      Agent.countDocuments(),
      Agent.countDocuments({ isVerified: false }), 
      
      // Daily Revenue - Added $ifNull safety
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),

      // Weekly Revenue - Added $ifNull safety
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfWeek } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),

      // Monthly Revenue - Added $ifNull safety
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),

      // Yearly Revenue - Added $ifNull safety
      Agent.aggregate([
        { $match: { isSubscribed: true, subscriptionDate: { $ne: null, $gte: startOfYear } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } } } }
      ]),

      // --- DYNAMIC CHART DATA (FIXED: Bypassing %a format error) ---
      Agent.aggregate([
        { 
          $match: { 
            isSubscribed: true, 
            subscriptionDate: { $ne: null, $gte: sevenDaysAgo } 
          } 
        },
        {
          $group: {
            _id: { $dayOfWeek: "$subscriptionDate" }, // Returns number 1-7
            revenue: { $sum: { $ifNull: ["$paymentDetails.amountNgn", 0] } }
          }
        },
        {
          $project: {
            revenue: 1,
            order: "$_id",
            // Manually map numbers to Day Names to avoid %a error
            name: {
              $switch: {
                branches: [
                  { case: { $eq: ["$_id", 1] }, then: "Sun" },
                  { case: { $eq: ["$_id", 2] }, then: "Mon" },
                  { case: { $eq: ["$_id", 3] }, then: "Tue" },
                  { case: { $eq: ["$_id", 4] }, then: "Wed" },
                  { case: { $eq: ["$_id", 5] }, then: "Thu" },
                  { case: { $eq: ["$_id", 6] }, then: "Fri" },
                  { case: { $eq: ["$_id", 7] }, then: "Sat" }
                ],
                default: "Day"
              }
            }
          }
        },
        { $sort: { order: 1 } }
      ])
    ]);

    const chartData = dynamicChart.length > 0 
      ? dynamicChart.map(item => ({ name: item.name, revenue: item.revenue }))
      : [{ name: 'Last 7 Days', revenue: 0 }];

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
    console.error("Stats API Failure:", err.message);
    res.status(500).json({ success: false, message: "Error fetching stats", details: err.message });
  }
});

router.get('/agents', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
        const agents = await Agent.find({})
      .select('firstName lastName email program isVerified photoUrl lastActive createdAt isSubscribed')
      .sort({ createdAt: -1 })
      .lean();
    const now = new Date();
    const formattedAgents = await Promise.all(agents.map(async (agent) => {
      const lastActiveDate = agent.lastActive || agent.createdAt;
      const isOnline = (now - new Date(lastActiveDate)) < 120000;
  
      let photo = agent.photoUrl;
      try {
        if (typeof getPrivateUrl === 'function' && photo && photo.includes('profiles/')) {
          photo = await getPrivateUrl(agent.photoUrl);
        }
      } catch (err) {
        console.warn(`[IMAGE_SIGN_FAILED] Agent ${agent._id}:`, err.message);
        photo = null; 
      }

      return {
        _id: agent._id,
        firstName: agent.firstName || "N/A",
        lastName: agent.lastName || "",
        email: agent.email || "No Email",
        program: agent.program || "General",
        isVerified: !!agent.isVerified,
        isSubscribed: !!agent.isSubscribed,
        status: isOnline ? 'online' : 'offline',
        photoUrl: photo || `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff`
      };
    }));

    res.json({ 
      success: true, 
      count: formattedAgents.length,
      agents: formattedAgents 
    });

  } catch (err) {
    console.error("CRITICAL: Admin Agent List Failure:", err); 
    res.status(500).json({ 
      success: false, 
      message: "Internal Server Error",
      error: err.message 
    });
  }
});

/**
 * @route   GET /api/admin/agents/:id
 * @desc    Fetch detailed profile for a single agent with subscription sync (SECURE)
 */
router.get('/agents/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    
    const agent = await Agent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent record not found in system" });
    }

    const now = new Date();
    let needsSave = false;

    // --- 1. SILENT EXPIRATION SYNC ---
    if (agent.isSubscribed && agent.expiryDate && now > new Date(agent.expiryDate)) {
      agent.isSubscribed = false;
      needsSave = true;
    }
    if (agent.voicePackageActive && agent.voicePackageExpiry && now > new Date(agent.voicePackageExpiry)) {
      agent.voicePackageActive = false;
      needsSave = true;
    }
    if (needsSave) await agent.save();

    // --- 2. SECURE PHOTO SIGNING (Using your exported helper) ---
    // This replaces all the manual GetObjectCommand logic
    const finalPhotoUrl = await getPrivateUrl(agent.photoUrl) || 
      `https://ui-avatars.com/api/?name=${agent.firstName}+${agent.lastName}&background=0D1117&color=fff&size=128`;

    // --- 3. STATUS CALCULATION ---
    const lastActiveDate = agent.lastActive || agent.createdAt;
    const isOnline = (now - new Date(lastActiveDate)) < 120000;

    // --- 4. RETURN FORMATTED RESPONSE ---
    res.json({
      success: true,
      agent: {
        ...agent.toObject(), // Spreads all fields correctly
        photoUrl: finalPhotoUrl,
        status: isOnline ? 'online' : 'offline',
        isSubscribed: !!agent.isSubscribed, 
        voicePackageActive: !!agent.voicePackageActive, 
        isVerified: !!agent.isVerified
      }
    });

  } catch (err) {
    console.error("Admin Agent Fetch Error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error accessing agent data" });
  }
});

/**
 * @route   GET /api/admin/support/conversations
 * @desc    Fetch a list of unique guests who have messaged support
 */
router.get('/support/conversations', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    
    // Group messages by guestId to get a list of "chats"
    const conversations = await SupportMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$guestId",
          lastMessage: { $first: "$text" },
          lastTimestamp: { $first: "$createdAt" },
          unreadCount: { 
            $sum: { $cond: [{ $and: [{ $eq: ["$senderType", "Guest"] }, { $eq: ["$isAdminRead", false] }] }, 1, 0] } 
          }
        }
      },
      { $sort: { lastTimestamp: -1 } }
    ]);

    res.json({ success: true, conversations });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching support inbox" });
  }
});

/**
 * @route   GET /api/admin/support/messages/:guestId
 * @desc    Fetch full chat history for a specific guest
 */
router.get('/support/messages/:guestId', authenticateToken, isAdmin, async (req, res) => {
  try {
    await connectToDatabase();
    const { guestId } = req.params;

    const messages = await SupportMessage.find({ guestId }).sort({ createdAt: 1 });
    
    // Mark messages as read when admin opens the chat
    await SupportMessage.updateMany(
      { guestId, senderType: 'Guest', isAdminRead: false },
      { $set: { isAdminRead: true } }
    );

    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching messages" });
  }
});

export default router;