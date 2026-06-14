import express from 'express';
import mongoose from 'mongoose';
import { authenticateToken } from '../middlewares/auth.js'; // Adjust path to your middleware

const router = express.Router();

router.get('/bundle/:userId', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const modelName = req.query.model === 'Agent' ? 'Agent' : 'User';
    const TargetModel = mongoose.model(modelName);

    // 1. Fetch only the necessary data
    const user = await TargetModel.findById(userId).select('publicKeyJwk');

    if (!user || !user.publicKeyJwk?.preKeys?.length) {
      return res.status(404).json({ success: false, message: "No pre-keys available for this user." });
    }

    // 2. Safely get the first key
    const preKey = user.publicKeyJwk.preKeys[0];

    // 3. Atomically remove the key we just fetched
    await TargetModel.updateOne(
      { _id: userId },
      { $pull: { "publicKeyJwk.preKeys": { keyId: preKey.keyId } } }
    );

    return res.status(200).json({ 
      success: true, 
      registrationId: user.publicKeyJwk.registrationId,
      identityKey: user.publicKeyJwk.identityKey,
      signedPreKey: user.publicKeyJwk.signedPreKey,
      preKey: preKey
    });
  } catch (err) {
    console.error("Bundle Fetch Error:", err);
    next(err);
  }
});
export default router;