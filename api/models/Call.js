import mongoose from 'mongoose';

const callSchema = new mongoose.Schema({
  roomName: { 
    type: String, 
    required: true, 
    unique: true 
  },
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'callerModel'
  },
  callerModel: {
    type: String,
    required: true,
    enum: ['User', 'Agent']
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'receiverModel'
  },
  receiverModel: {
    type: String,
    required: true,
    enum: ['User', 'Agent']
  },
  voiceId: { type: String, default: null },
  voiceDisplayName: { type: String, default: 'Natural Voice' },
  isMasked: { type: Boolean, default: false },
  isEliteVoice: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['calling', 'ringing', 'connected', 'ended', 'missed', 'rejected'],
    default: 'ringing'
  },
  active: { type: Boolean, default: true },
  startTime: { type: Date },
  endTime: { type: Date },
  duration: { type: Number, default: 0 } 
}, { 
  timestamps: true,
  minimize: false,
  // 🔥 SHARDING: Essential for scaling to millions
  shardKey: { roomName: 1 } 
});

// Optimized Indexes for performance
callSchema.index({ receiver: 1, status: 1 });
callSchema.index({ caller: 1, status: 1 });
callSchema.index({ active: 1, createdAt: -1 });

/**
 * 🔥 UPDATED LOGIC: 
 * We now export the model using the standard mongoose object. 
 * Because connectToDatabase() updates the default connection, 
 * this will automatically point to whichever DB is currently active (Primary or Reserve).
 */
const Call = mongoose.models.Call || mongoose.model('Call', callSchema);
export default Call;