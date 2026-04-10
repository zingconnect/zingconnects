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
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  password: { 
    type: String, 
    required: true, 
    select: false 
  }, 
  slug: { 
    type: String, 
    required: true, 
    unique: true,
    index: true // Optimization for profile lookups
  },
  address: String,
  occupation: String,
  program: String,
  bio: String,
  dob: { type: Date }, // Consistent with registration/auth logic
  gender: String,
  role: { type: String, default: 'agent' },
  photoUrl: { type: String, default: '' },

  lastActive: { 
    type: Date, 
    default: Date.now 
  },
  
  // --- SUBSCRIPTION & PAYMENT FIELDS ---
  plan: { 
    type: String, 
    enum: ['BASIC', 'GROWTH', 'PROFESSIONAL'], 
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
  
  subscriptionDate: { type: Date },
  subscriptionAmount: { type: Number, default: 0 }, // USD Amount
  expiryDate: { type: Date }, 
  
  expiryNotificationSent: { 
    type: Boolean, 
    default: false 
  },
  paymentDetails: {
    amountNgn: { type: Number },
    rateUsed: { type: Number },
    currency: { type: String, default: 'NGN' }
  },

  lastTransactionId: { type: String, default: '' }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }, // Required for the dashboard to see isExpired
  toObject: { virtuals: true } 
});

// --- VIRTUALS ---
// This allows the frontend to check agent.isExpired without extra logic
agentSchema.virtual('isExpired').get(function() {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Prevent model overwrite error in development/hot-reloading
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;