import express from 'express';
import { authenticateToken } from './auth.js'; 
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
 * Standard start route.
 */
router.post('/start', authenticateToken, startCall); 

/**
 * 2. DISCOVERY & POLLING
 * Changed /status to use :callId to match your frontend fetch calls.
 */
router.get('/check-incoming', authenticateToken, checkIncomingCall);
router.get('/status/:callId', authenticateToken, getCallStatus); 

/**
 * 3. LIFECYCLE MANAGEMENT
 * FIX: Added /:callId to 'accept' and 'end' to prevent 404 HTML errors.
 */
router.post('/accept/:callId', authenticateToken, acceptCall);
router.post('/end/:callId', authenticateToken, endCall);

/**
 * NOTE: Legacy signaling routes (update-signal, answer-signal) 
 * are removed because LiveKit handles media negotiation automatically.
 */

export default router;