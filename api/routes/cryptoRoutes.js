import express from 'express';
import mongoose from 'mongoose';
import { authenticateToken } from '../middlewares/auth.js'; // Adjust path to your middleware

const router = express.Router();

router.get('/bundle/:userId', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const modelName = req.query.model === 'Agent' ? 'Agent' : 'User';
    
    // 1. First, find the user to see if they exist at all
    const TargetModel = mongoose.model(modelName);
    const userExists = await TargetModel.findById(userId);
    
    if (!userExists) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // 2. Perform the atomic update checking ONLY for the existence of keys
    // We removed 'isCryptoReady: true' as it is not present in your current schema
    const updatedUser = await TargetModel.findOneAndUpdate(
      { _id: userId, "publicKeyJwk.preKeys.0": { $exists: true } },
      { $pop: { "publicKeyJwk.preKeys": -1 } },
      { returnDocument: 'before' }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "No pre-keys available for this user." });
    }

    const { publicKeyJwk } = updatedUser;
    
    return res.status(200).json({ 
      success: true, 
      registrationId: publicKeyJwk.registrationId,
      identityKey: publicKeyJwk.identityKey,
      signedPreKey: publicKeyJwk.signedPreKey,
      preKey: publicKeyJwk.preKeys[0]
    });
  } catch (err) {
    console.error("Bundle Fetch Error:", err);
    next(err);
  }
});

export default router;