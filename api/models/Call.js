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
  default: true // Ensure this is flipped to false on endCall
},
  signal: { 
    type: Object 
  },
  startTime: { type: Date },
  endTime: { type: Date },
}, { timestamps: true });

// Create an index to make the polling route extremely fast
callSchema.index({ receiver: 1, status: 1 });

const Call = mongoose.model('Call', callSchema);
export default Call;