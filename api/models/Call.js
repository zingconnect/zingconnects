import mongoose from 'mongoose';

const callSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['calling', 'ringing', 'connected', 'ended', 'missed', 'declined'],
    default: 'calling'
  },
  active: { 
    type: Boolean, 
    default: true 
  },
  // Use Mixed type for WebRTC signals to ensure all nested properties are saved
  signal: { 
    type: mongoose.Schema.Types.Mixed 
  },
  answerSignal: { 
    type: mongoose.Schema.Types.Mixed 
  },
  startTime: { type: Date },
  endTime: { type: Date },
}, { 
  timestamps: true,
  minimize: false // Ensures empty objects are still stored in the DB if necessary
});

// Indices for performance
callSchema.index({ receiver: 1, status: 1 });
callSchema.index({ caller: 1, status: 1 }); // Added this for Agent polling

const Call = mongoose.model('Call', callSchema);
export default Call;