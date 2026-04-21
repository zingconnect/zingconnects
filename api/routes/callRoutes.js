import express from 'express';
// FIXED: Changed 'authenticate' to 'authenticateToken' to match your auth.js export
import { authenticateToken } from './auth.js'; 
import { 
  startCall, 
  checkIncomingCall, 
  acceptCall, 
  endCall 
} from '../controllers/callController.js';

const router = express.Router();

// --- PROTECTED ROUTES ---

/**
 * @route   POST /api/calls/start
 * @desc    User or Agent initiates a secure call
 */
router.post('/start', authenticateToken, startCall); 

/**
 * @route   GET /api/calls/check-incoming
 * @desc    Polls for any ringing calls assigned to the current user
 */
router.get('/check-incoming', authenticateToken, checkIncomingCall);

/**
 * @route   POST /api/calls/accept
 * @desc    Updates call status to 'connected'
 */
router.post('/accept', authenticateToken, acceptCall);

/**
 * @route   POST /api/calls/end
 * @desc    Ends an active call or declines an incoming one
 */
router.post('/end', authenticateToken, endCall);

export default router;