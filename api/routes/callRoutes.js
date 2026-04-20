import express from 'express';
// Assuming 'authenticate' is the named export from your auth file
import { authenticate } from './auth.js'; 
import { 
  checkIncomingCall, 
  acceptCall, 
  endCall 
} from '../controllers/callController.js';

const router = express.Router();

// Apply your 'authenticate' function to protect these routes
router.get('/check-incoming', authenticate, checkIncomingCall);
router.post('/accept', authenticate, acceptCall);
router.post('/end', authenticate, endCall);

export default router;