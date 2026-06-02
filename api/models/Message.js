import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'senderModel'
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'receiverModel'
  },
  senderModel: {
    type: String,
    required: true,
    enum: ['Agent', 'User']
  },
  receiverModel: {
    type: String,
    required: true,
    enum: ['Agent', 'User']
  },
  // --- CONTENT FIELDS ---
  text: {
    type: String,
    trim: true
  },
  callMetadata: {
    callId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call' },
    status: { 
      type: String, 
      enum: ['ringing', 'connected', 'missed', 'ended'], 
      default: 'ringing' 
    },
    duration: { type: Number, default: 0 } // In seconds
  },
  fileUrl: {
    type: String, // URL from S3/IDrive
    default: null
  },
 fileType: {
    type: String,
    enum: ['text', 'image', 'video', 'file', 'call_log'], 
    default: 'text'
  },
  isDeleted: {
  type: Boolean,
  default: false
},
  lastNotificationEmail: { type: Date, default: null },
notificationSent: {
    type: Boolean,
    default: false
  },  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent'
  },
  // Track specific timings for the UI
  deliveredAt: { type: Date },
  seenAt: { type: Date }
}, { 
  timestamps: true 
});

// Keep these for your primary chat load queries
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });

// Keep these for specific functional needs
messageSchema.index({ receiverId: 1, status: 1 });
messageSchema.index({ senderId: 1, receiverId: 1, fileType: 1 });


const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;