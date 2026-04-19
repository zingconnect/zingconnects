import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'senderModel' // Dynamic reference (can be Agent or User)
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
  text: {
    type: String,
    required: true,
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true 
});

// Indexing for faster chat loading
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: 1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;