import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

export const authenticateToken = async (req, res, next) => {
  // 1. Enforce Cookie-only authentication
  const token = req.signedCookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: "Access Denied: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.id = decoded.id || decoded._id;

    const redisClient = req.app.get('redisClient');

    // 2. Optimized Agent Logic (Using Redis Cache)
    if (decoded.role === 'agent') {
      const cacheKey = `agent:profile:${req.user.id}`;
      
      // Try fetching session/active status from cache
      let agentSession = await redisClient.get(cacheKey);
      
      if (!agentSession) {
        // Fallback to DB if cache miss
        const AgentModel = mongoose.models.Agent || mongoose.model('Agent');
        const agent = await AgentModel.findById(req.user.id).select('currentSessionId');
        
        if (!agent) return res.status(404).json({ success: false, message: "Agent context not found." });
        
        // Validate session ID
        if (agent.currentSessionId && decoded.sessionId && agent.currentSessionId !== decoded.sessionId) {
          return res.status(403).json({ success: false, message: "Dual login detected.", reason: "dual_login" });
        }
        
        // Update DB and prime cache for future requests
        await AgentModel.findByIdAndUpdate(req.user.id, { $set: { lastActive: new Date() } });
      }
    }

    // 3. Admin Logic (Optional: also cache this if admin traffic is high)
    if (['admin', 'superadmin'].includes(decoded.role)) {
      const AdminModel = mongoose.models.Admin || mongoose.model('Admin');
      // Consider debouncing this update to once every 5 minutes to save DB writes
      await AdminModel.findByIdAndUpdate(req.user.id, { $set: { lastLogin: new Date() } });
    }

    next();
  } catch (err) {
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