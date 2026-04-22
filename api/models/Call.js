import mongoose from 'mongoose';

const callSchema = new mongoose.Schema({
  // The ID of the person starting the call
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'callerModel' // Looks at the callerModel field to know which collection to join
  },
  // Tells Mongoose which collection the caller belongs to
  callerModel: {
    type: String,
    required: true,
    enum: ['User', 'Agent']
  },

  // The ID of the person receiving the call
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'receiverModel'
  },
  // Tells Mongoose which collection the receiver belongs to
  receiverModel: {
    type: String,
    required: true,
    enum: ['User', 'Agent']
  },
status: {
    type: String,
    enum: ['calling', 'ringing', 'connected', 'ended', 'missed', 'declined'],
    default: 'calling' // Starts at 'calling'
  },
  startTime: { type: Date },
  endTime: { type: Date },
}, { timestamps: true });

const Call = mongoose.model('Call', callSchema);
export default Call;