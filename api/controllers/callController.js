import Call from '../models/Call.js';

// @desc    Check for incoming calls (Polling)
// @route   GET /api/calls/check-incoming
export const checkIncomingCall = async (req, res) => {
  try {
    // We use the ID attached by your authenticate middleware
    const incoming = await Call.findOne({ 
      receiver: req.user._id, 
      status: 'ringing' 
    }).populate('caller', 'firstName lastName photoUrl');

    if (!incoming) return res.json({ hasIncomingCall: false });

    res.json({
      hasIncomingCall: true,
      callId: incoming._id,
      callerData: {
        fromName: `${incoming.caller.firstName} ${incoming.caller.lastName}`,
        photoUrl: incoming.caller.photoUrl
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Error checking incoming calls", error: error.message });
  }
};

// @desc    Accept an incoming call
// @route   POST /api/calls/accept
export const acceptCall = async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ message: "callId is required" });

    const call = await Call.findByIdAndUpdate(
      callId, 
      { status: 'connected', startTime: Date.now() }, 
      { new: true }
    );

    res.json({ success: true, call });
  } catch (error) {
    res.status(500).json({ message: "Error accepting call", error: error.message });
  }
};

// @desc    End/Decline/Cancel call
// @route   POST /api/calls/end
export const endCall = async (req, res) => {
  try {
    const { callId } = req.body;
    if (!callId) return res.status(400).json({ message: "callId is required" });

    await Call.findByIdAndUpdate(callId, { 
      status: 'ended', 
      endTime: Date.now() 
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Error ending call", error: error.message });
  }
};