import mongoose from 'mongoose';

export const agentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false }, 
  slug: { type: String, required: true, unique: true },
  address: String,
  occupation: String,
  program: String,
  bio: String,
  dob: Date,
  gender: String,
  role: { type: String, default: 'agent' },
  photoUrl: { type: String, default: '' },

  // --- SUBSCRIPTION & PAYMENT FIELDS ---
  plan: { 
    type: String, 
    enum: ['BASIC', 'GROWTH', 'PROFESSIONAL'], // Updated to match your Dashboard
    default: 'BASIC' 
  },
  isSubscribed: { 
    type: Boolean, 
    default: false 
  },
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'pending'], 
    default: 'active' 
  },
  
  // Track when the payment happened
  subscriptionDate: { type: Date },
  
  // CRITICAL: When the dashboard should lock
  expiryDate: { type: Date }, 
  
  // CRITICAL: Track if we've already warned them 3 days before expiry
  expiryNotificationSent: { 
    type: Boolean, 
    default: false 
  },

  lastTransactionId: { type: String, default: '' }
}, { timestamps: true });

// Prevent model overwrite error in development/hot-reloading
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;