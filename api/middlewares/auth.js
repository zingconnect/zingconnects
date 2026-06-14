import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';

export const authenticateToken = async (req, res, next) => {
  // DEBUG: Inspecting inputs
  console.log("--- AUTH DEBUG ---");
  console.log("Cookie Header received:", req.headers.cookie);
  
  const token = 
    req.signedCookies?.token || 
    req.cookies?.token || 
    req.headers['authorization']?.split(' ')[1];

  if (!token) {
    console.warn("Auth failed: No token found.");
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.id = decoded.id || decoded._id;

    await connectToDatabase();

    const redisClient = req.app.get('redisClient');
    if (!redisClient) {
      console.error("Redis client not found!");
      return res.status(503).json({ success: false, message: "Service unavailable" });
    }

  if (decoded.role === 'agent') {
  const cacheKey = `agent:profile:${req.user.id}`;
  const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
  
  // 1. Initialize 'agent' variable FIRST
  const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
  
  if (!agent) return res.status(404).json({ success: false, message: "Agent context not found." });

  // 2. Now it is safe to log and use 'agent'
  console.log("DEBUG: Checking session:", {
    tokenSession: decoded.sessionId,
    dbSession: agent.currentSessionId
  });

  if (agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
    return res.status(403).json({ success: false, message: "Dual login detected.", reason: "dual_login" });
  }
      
      if (!agentSession) {
        await AgentModel.findByIdAndUpdate(req.user.id, { $set: { lastActive: new Date() } });
      }
    }

    // 4. Admin Logic
    if (['admin', 'superadmin'].includes(decoded.role)) {
      const AdminModel = mongoose.models.Admin || mongoose.model('Admin');
      await AdminModel.updateOne({ _id: req.user.id }, { $set: { lastLogin: new Date() } });
    }

    next();
  } catch (err) {
    console.error("JWT Verification failed. Error Name:", err.name, "Message:", err.message);
    if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: "Token expired" });
    if (err.name === 'JsonWebTokenError') return res.status(403).json({ success: false, message: "Invalid token" });
    
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
};

export const isAdmin = (req, res, next) => {
  if (req.user?.role === 'admin' || req.user?.role === 'superadmin') return next();
  return res.status(403).json({ success: false, message: "Admin privileges required." });
};

export const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role === 'superadmin') return next();
  return res.status(403).json({ success: false, message: "Superadmin authorization required." });
};