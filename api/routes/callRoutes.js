import express from 'express';
import { authenticateToken } from './auth.js'; 
import { 
  startCall, 
  checkIncomingCall, 
  acceptCall, 
  endCall,
  getCallStatus // <--- 1. Import this (you'll need to create it in your controller)
} from '../controllers/callController.js';

const router = express.Router();

// --- PROTECTED ROUTES ---

router.post('/start', authenticateToken, startCall); 

router.get('/check-incoming', authenticateToken, checkIncomingCall);

/**
 * @route   GET /api/calls/status/:callId
 * @desc    Check if a specific call is still active, ringing, or ended
 */
router.get('/status/:callId', authenticateToken, getCallStatus); // <--- 2. ADD THIS ROUTE

router.post('/accept', authenticateToken, acceptCall);

router.post('/end', authenticateToken, endCall);

export default router;