import express from 'express';
import mongoose from 'mongoose';
import { authenticateToken } from '../middlewares/auth.js'; 

const router = express.Router();

router.get('/bundle/:userId', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = req.params;
    // Default to deviceId 1 if not provided
    const deviceId = parseInt(req.query.deviceId) || 1;
    const modelName = req.query.model === 'Agent' ? 'Agent' : 'User';
    const TargetModel = mongoose.model(modelName);

    // 1. Fetch only the specific device entry for the user/agent
    // Using projection "devices.$" to only return the matched device
    const user = await TargetModel.findOne(
      { _id: userId, "devices.deviceId": deviceId },
      { "devices.$": 1 }
    );
    
    if (!user || !user.devices || user.devices.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: `No crypto bundle found for device ${deviceId}.` 
      });
    }

    const device = user.devices[0];

    // 2. Validate PreKey availability
    if (!device.preKeys || device.preKeys.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "No pre-keys available for this device." 
      });
    }

    // 3. Safely get the first key
    const preKey = device.preKeys[0];

    // 4. Atomically remove ONLY the specific key consumed from the specific device
    const result = await TargetModel.updateOne(
      { _id: userId, "devices.deviceId": deviceId },
      { $pull: { "devices.$.preKeys": { keyId: preKey.keyId } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ success: false, message: "Failed to consume pre-key." });
    }

    // 5. Return the bundle
    return res.status(200).json({ 
      success: true, 
      registrationId: device.registrationId,
      identityKey: device.identityKey,
      signedPreKey: device.signedPreKey,
      preKey: preKey
    });

  } catch (err) {
    console.error("Bundle Fetch Error:", err);
    next(err);
  }
});

export default router;