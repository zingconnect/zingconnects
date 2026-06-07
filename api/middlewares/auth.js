import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';

export const authenticateToken = async (req, res, next) => {
  // 1. Get token from standard cookies (since we disabled 'signed' to avoid signature mismatch)
  const token = req.cookies?.token;

  if (!token) {
    console.warn("Auth failed: No token detected in cookies.");
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Normalize user object to ensure 'id' and 'role' are always present
    req.user = {
      id: decoded.id || decoded._id,
      role: decoded.role || 'user', // Default to 'user' if not specified in JWT
      sessionId: decoded.sessionId || null
    };

    await connectToDatabase();

    const redisClient = req.app.get('redisClient');
    if (!redisClient) {
      console.error("Redis client not found in app context!");
      return res.status(503).json({ success: false, message: "Service temporarily unavailable" });
    }

    // 3. Role-specific logic
    if (req.user.role === 'agent') {
      const cacheKey = `agent:profile:${req.user.id}`;
      let agentSession = await redisClient.get(cacheKey);
      
      if (!agentSession) {
        const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
        const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
        
        if (!agent) return res.status(404).json({ success: false, message: "Agent context not found." });
        
        // Check for concurrent sessions
        if (agent.currentSessionId && req.user.sessionId && agent.currentSessionId !== req.user.sessionId) {
          return res.status(403).json({ success: false, message: "Dual login detected.", reason: "dual_login" });
        }
        
        await AgentModel.findByIdAndUpdate(req.user.id, { $set: { lastActive: new Date() } });
      }
    } else if (['admin', 'superadmin'].includes(req.user.role)) {
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