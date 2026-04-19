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
    // Not required anymore because message might be just an image/video
  },
  fileUrl: {
    type: String, // URL from S3/IDrive
    default: null
  },
  fileType: {
    type: String,
    enum: ['text', 'image', 'video', 'file'],
    default: 'text'
  },
  // --- STATUS TRACKING ---
  status: {
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

// Indexing for faster chat loading and status updates
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: 1 });
messageSchema.index({ receiverId: 1, status: 1 }); // Useful for "Mark all as seen"

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;