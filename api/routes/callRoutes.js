import express from 'express';
import { authenticateToken } from './auth.js'; 
import { 
  startCall, 
  checkIncomingCall, 
  acceptCall, 
  endCall,
  getCallStatus,
  updateCallSignal // <--- Add this for WebRTC handshake
} from '../controllers/callController.js';

const router = express.Router();

// 1. Initiation
router.post('/start', authenticateToken, startCall); 

// 2. Discovery (Polling for the Receiver)
router.get('/check-incoming', authenticateToken, checkIncomingCall);

// 3. Heartbeat (Checking if the call is still alive)
router.get('/status/:callId', authenticateToken, getCallStatus); 

// 4. Signaling (The "Audio Bridge")
router.patch('/update-signal', authenticateToken, updateCallSignal);

// 5. Connection & Cleanup
router.post('/accept', authenticateToken, acceptCall);
router.post('/end', authenticateToken, endCall);

export default router;