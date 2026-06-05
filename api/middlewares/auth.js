import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';

export const authenticateToken = async (req, res, next) => {
  const token = req.cookies?.token; 

  if (!token) {
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    // 1. Verify token first (no DB required)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.id = decoded.id || decoded._id;

    // 2. FORCE CONNECTION: Await the database initialization.
    // This solves the MongooseError by ensuring the connection is established
    // before any model operations are called.
    await connectToDatabase();

    const redisClient = req.app.get('redisClient');
    if (!redisClient) {
      console.error("Redis client not found in app context!");
      return res.status(503).json({ success: false, message: "Service temporarily unavailable" });
    }

    // 3. Agent Logic
    if (decoded.role === 'agent') {
      const cacheKey = `agent:profile:${req.user.id}`;
      let agentSession = await redisClient.get(cacheKey);
      
      if (!agentSession) {
        const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
        const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
        
        if (!agent) return res.status(404).json({ success: false, message: "Agent context not found." });
        
        if (agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
          return res.status(403).json({ success: false, message: "Dual login detected.", reason: "dual_login" });
        }
        
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
    console.error("AUTH MIDDLEWARE CRASH:", err);
    if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: "Token expired" });
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