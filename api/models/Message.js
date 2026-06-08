import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  // Polymorphic ID references
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

  // 🔒 ARCHITECTURE: Grouping and Sequencing
  conversationId: {
    type: String,
    required: true,
    index: true // Crucial for fetching chat history in O(1) time
  },
  sequenceNumber: {
    type: Number,
    default: 0 // Required for Double Ratchet protocol to prevent replay attacks
  },

  // E2EE Payload
  payload: {
    type: {
      ciphertext: { type: String, required: false },
      iv: { type: String, required: false },
      version: { type: Number, default: 1 }
    },
    default: null
  },
  text: { type: String, trim: false },
  fileUrl: { type: String, default: null },
  fileType: {
    type: String,
    enum: ['text', 'image', 'video', 'file', 'call_log'],
    default: 'text'
  },

  // Metadata & Status
  isEncrypted: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent'
  },
  deliveredAt: { type: Date },
  seenAt: { type: Date },
  notificationSent: { type: Boolean, default: false },
  lastNotificationEmail: { type: Date, default: null }
}, {
  timestamps: true
});

// --- INDEXING STRATEGY ---

// 1. History retrieval per conversation
messageSchema.index({ conversationId: 1, createdAt: -1 });

// 2. Optimized index for decryption-heavy queries (e.g., "get all my unread/encrypted messages")
messageSchema.index({ receiverId: 1, isEncrypted: 1, createdAt: -1 });

// 3. Performance index for sender/receiver lookups
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ receiverId: 1, senderId: 1, createdAt: -1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;