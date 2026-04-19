import mongoose from 'mongoose';

export const agentSchema = new mongoose.Schema({
  firstName: { 
    type: String, 
    required: true, 
    trim: true, 
    set: v => v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v
  },
  lastName: { 
    type: String, 
    required: true, 
    trim: true, 
    set: v => v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, // This automatically handles the index.
    lowercase: true, 
    trim: true 
  },
  password: { type: String, required: true, select: false },
  slug: { 
    type: String, 
    required: true, 
    unique: true // Ensure no extra index: true is added here
  },
  address: String,
  occupation: String,
  program: String,
  bio: String,
  dob: { type: Date }, 
  gender: String,
  role: { type: String, default: 'agent' },
  photoUrl: { type: String, default: '' },

  // --- VERIFICATION FIELDS ---
  isVerified: { type: Boolean, default: false },
  otp: { type: String },
  otpExpires: { type: Date },

  lastActive: { type: Date, default: Date.now },
  
  // --- SUBSCRIPTION & PAYMENT FIELDS ---
  plan: { 
    type: String, 
    enum: ['BASIC', 'GROWTH', 'PROFESSIONAL'], 
    default: 'BASIC' 
  },
  isSubscribed: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'pending'], 
    default: 'pending' 
  },
  
  subscriptionDate: { type: Date },
  subscriptionAmount: { type: Number, default: 0 }, 
  expiryDate: { type: Date }, 
  
  expiryNotificationSent: { type: Boolean, default: false },
  paymentDetails: {
    amountNgn: { type: Number },
    rateUsed: { type: Number },
    currency: { type: String, default: 'NGN' }
  },
  lastTransactionId: { type: String, default: '' }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
});

// --- AUTO-CLEANUP INDEX ---
// This deletes the document after 24 hours ONLY if isVerified is still false.
agentSchema.index({ createdAt: 1 }, { 
  expireAfterSeconds: 86400, 
  partialFilterExpression: { isVerified: false } 
});

// --- VIRTUALS ---
agentSchema.virtual('isExpired').get(function() {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Initialize model
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;