import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';

export const authenticateToken = async (req, res, next) => {
  // Debug logs
  console.log("DEBUG: Cookie Header:", req.headers.cookie);
  
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

    // Agent Logic with Session Validation
    if (decoded.role === 'agent') {
      const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
      
      const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
      
      if (!agent) {
        return res.status(404).json({ success: false, message: "Agent context not found." });
      }

      // Check if session matches
      if (agent.currentSessionId !== decoded.sessionId) {
        console.warn("DEBUG AUTH: SESSION REJECTED - Dual Login detected.");
        return res.status(403).json({ 
          success: false, 
          message: "Dual login detected.", 
          reason: "dual_login" 
        });
      }
      
      // Successfully validated: Update activity timestamp
      await AgentModel.findByIdAndUpdate(req.user.id, { $set: { lastActive: new Date() } });
    }

    // Admin Logic
    if (['admin', 'superadmin'].includes(decoded.role)) {
      const AdminModel = mongoose.models.Admin || mongoose.model('Admin');
      await AdminModel.updateOne({ _id: req.user.id }, { $set: { lastLogin: new Date() } });
    }

    next();
  } catch (err) {
    console.error("JWT Verification failed. Error Name:", err.name, "Message:", err.message);
    if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: "Token expired" });
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
};