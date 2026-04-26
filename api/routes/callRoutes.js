import express from 'express';
import { authenticateToken } from './auth.js'; 
import { 
  startCall, 
  checkIncomingCall, 
  acceptCall, 
  endCall,
  getCallStatus,
  answerCallSignal,
  updateCallSignal 
} from '../controllers/callController.js';

const router = express.Router();

/**
 * 1. INITIATION
 * Called by the Caller to create the DB record and store the first signal.
 */
router.post('/start', authenticateToken, startCall); 

/**
 * 2. DISCOVERY & POLLING
 * check-incoming: Called by Receiver to find ringing calls.
 * status: Called by Caller to see if the Receiver has answered yet.
 */
router.get('/check-incoming', authenticateToken, checkIncomingCall);
router.get('/status/:callId', authenticateToken, getCallStatus); 

/**
 * 3. SIGNALING (WebRTC Handshake)
 * update-signal: General purpose (usually for sending the initial Offer signal).
 * answer-signal: Specifically for the Receiver to send the Answer signal back.
 */
router.patch('/update-signal', authenticateToken, updateCallSignal);
router.patch('/answer-signal', authenticateToken, answerCallSignal);

/**
 * 4. LIFECYCLE MANAGEMENT
 * accept: Formally moves the DB status to 'connected'.
 * end: Terminates the session for both parties.
 */
router.post('/accept', authenticateToken, acceptCall);
router.post('/end', authenticateToken, endCall);

export default router;