import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  // --- IDENTIFIERS (Metadata only) ---
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

  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'receiverModel',
    index: true // Crucial: You will frequently query messages by receiver
  },
  receiverModel: {
    type: String,
    required: true,
    enum: ['Agent', 'User']
  },

  payload: {
    ciphertext: { type: String, required: true }, // Encrypted blob
    iv: { type: String, required: true },         // Initialization Vector
    ephemeralKey: { type: String, required: true }, // Public DH key for ratchet
    counter: { type: Number, required: true },    // Sequence number
    previousCounter: { type: Number, required: true }, // For out-of-order handling
    type: { type: String, enum: ['prekey', 'message'], required: true }
  },

  // --- STATUS & METADATA ---
  status: {
    type: String,
    enum: ['sent', 'delivered', 'seen'],
    default: 'sent'
  },
  deliveredAt: { type: Date },
  seenAt: { type: Date }
}, {
  timestamps: true // createdAt is used for message ordering
});

// --- INDEXING STRATEGY ---
// Crucial for performance without revealing content
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, receiverId: 1, createdAt: -1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
export default Message;