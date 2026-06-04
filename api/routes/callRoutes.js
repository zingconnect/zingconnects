import express from 'express';
import { authenticateToken } from '../middlewares/auth.js';
import { 
  startCall, 
  checkIncomingCall, 
  acceptCall, 
  endCall,
  getCallStatus
} from '../controllers/callController.js';

const router = express.Router();

/**
 * 1. INITIATION
 * Standard clean start endpoint route.
 */
router.post('/start', authenticateToken, startCall); 

/**
 * 2. DISCOVERY & POLLING
 * Background worker loops use these hooks to check for status updates cleanly.
 */
router.get('/check-incoming', authenticateToken, checkIncomingCall);
router.get('/status/:callId', authenticateToken, getCallStatus); 

/**
 * 3. LIFECYCLE MANAGEMENT
 * Tracks immediate structural states via specific ID route params.
 */
router.post('/accept/:callId', authenticateToken, acceptCall);
router.post('/end/:callId', authenticateToken, endCall);

export default router;