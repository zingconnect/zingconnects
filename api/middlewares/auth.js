import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';

export const authenticateToken = async (req, res, next) => {

console.log("--- AUTH DEBUG ---");
  console.log("All Cookies:", req.cookies); // Standard cookies
  console.log("Signed Cookies:", req.signedCookies); // Signed cookies
  console.log("Authorization Header:", req.headers.authorization);
  console.log("--- RAW REQUEST HEADERS ---");
  console.log(req.headers); 
  console.log("Cookie Header received by server:", req.headers.cookie);
  
const token = 
    req.signedCookies?.token || 
    req.cookies?.token || 
    req.headers['authorization']?.split(' ')[1];

  if (!token) {
    console.warn("Auth failed: No token found in any location.");
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.id = decoded.id || decoded._id;

    await connectToDatabase();

    const redisClient = req.app.get('redisClient');
    if (!redisClient) {
      console.error("Redis client not found in app context!");
      return res.status(503).json({ success: false, message: "Service temporarily unavailable" });
    }
console.log("DEBUG: Checking session:", {
  tokenSession: decoded.sessionId,
  dbSession: agent.currentSessionId
});
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
  console.error("JWT Verification failed. Error Name:", err.name, "Message:", err.message);
  if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: "Token expired" });
  if (err.name === 'JsonWebTokenError') return res.status(403).json({ success: false, message: "Invalid token signature or format" });
  
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