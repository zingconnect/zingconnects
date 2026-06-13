import express from 'express';
import mongoose from 'mongoose';
import { authenticateToken } from '../middlewares/auth.js'; // Adjust path to your middleware

const router = express.Router();

router.get('/bundle/:userId', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const modelName = req.query.model === 'Agent' ? 'Agent' : 'User';
    const TargetModel = mongoose.model(modelName);

    // Atomic fetch and consume
    const updatedUser = await TargetModel.findOneAndUpdate(
      { _id: userId, isCryptoReady: true, "publicKeyJwk.preKeys.0": { $exists: true } },
      { $pop: { "publicKeyJwk.preKeys": -1 } },
      { returnDocument: 'before' }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "No keys available or user not ready." });
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
    next(err);
  }
});

export default router;