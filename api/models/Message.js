import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  // --- IDENTIFIERS ---
  conversationId: {
    type: String,
    required: true,
    index: true 
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'senderModel'
  },
  senderModel: {
    type: String,
    required: true,
    enum: ['Agent', 'User']
  },
  // 🛡️ MULTI-DEVICE ADDITION
  senderDeviceId: { 
    type: Number, 
    required: true 
  },

  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'receiverModel',
    index: true 
  },
  receiverModel: {
    type: String,
    required: true,
    enum: ['Agent', 'User']
  },
  // 🛡️ MULTI-DEVICE ADDITION (Optional but recommended)
  receiverDeviceId: { 
    type: Number,
    default: null // Null if broadcast to all devices, or specific ID
  },

  payload: {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    ephemeralKey: { type: String, required: true },
    counter: { type: Number, required: true },
    previousCounter: { type: Number, required: true },
    type: { type: String, enum: ['prekey', 'message'], required: true }
  },

  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent'
  },
  deliveredAt: { type: Date },
  seenAt: { type: Date }
}, {
  timestamps: true 
});

// --- INDEXING STRATEGY ---
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, receiverId: 1, createdAt: -1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;