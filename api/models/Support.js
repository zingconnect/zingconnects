import mongoose from 'mongoose';

const supportSchema = new mongoose.Schema({
  // Use String instead of ObjectId to support 'guest_xxxx' IDs
  guestId: { 
    type: String, 
    required: true, 
    index: true 
  },
  senderType: { 
    type: String, 
    enum: ['Guest', 'Admin'], 
    required: true 
  },
  text: { 
    type: String, 
    required: true, 
    trim: true 
  },
  // Optional: tracking if the admin has seen the message
  isAdminRead: { 
    type: Boolean, 
    default: false 
  }
}, { 
  timestamps: true 
});

const SupportMessage = mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportSchema);

const SupportMessage = mongoose.models && mongoose.models.SupportMessage 
  ? mongoose.models.SupportMessage 
  : mongoose.model('SupportMessage', supportSchema);

export default SupportMessage;