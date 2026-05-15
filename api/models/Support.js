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
  enum: ['Guest', 'Admin', 'admin'], 
  required: true 
},
  text: { 
    type: String, 
    required: true, 
    trim: true 
  },
  // Tracks if the admin has seen the message for the dashboard inbox
  isAdminRead: { 
    type: Boolean, 
    default: false 
  }
}, { 
  timestamps: true 
});

// Robust model initialization for Vercel/Serverless
const SupportMessage = mongoose.models && mongoose.models.SupportMessage 
  ? mongoose.models.SupportMessage 
  : mongoose.model('SupportMessage', supportSchema);

export default SupportMessage;