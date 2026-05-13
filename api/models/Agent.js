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
  password: { type: String, required: true, select: false },
  slug: { 
    type: String, 
    required: true, 
    unique: true,
    index: true // 👈 Added for fast profile lookups
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
  isVerified: { type: Boolean, default: false, index: true }, // 👈 Indexed for cleanup logic
  otp: { type: String },
  otpExpires: { type: Date },

  lastActive: { type: Date, default: Date.now },
  pushSubscription: {
    type: Object,
    default: null
  },

  // --- MAIN SUBSCRIPTION PLAN ---
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
  currentSessionId: { type: String, default: null },
  subscriptionDate: { type: Date },
  subscriptionAmount: { type: Number, default: 0 }, 
  expiryDate: { type: Date }, 
  
  expiryNotificationSent: { type: Boolean, default: false },
  paymentDetails: {
    amountNgn: { type: Number },
    rateUsed: { type: Number },
    currency: { type: String, default: 'NGN' }
  },
  lastTransactionId: { type: String, default: '' },

  // 🎙️ VOICE IDENTITY MASKING
  voiceId: { 
    type: String, 
    default: null 
  },
  voiceDisplayName: {
    type: String,
    default: "Natural Voice" 
  },
  unlockedVoiceIds: { 
    type: [String], 
    default: [] 
  },
  // Added: Master UI toggle for the masking feature
  voiceMaskingEnabled: {
    type: Boolean,
    default: false
  },
  voicePackageActive: { 
    type: Boolean, 
    default: false 
  },
  voicePackageExpiry: { 
    type: Date 
  },
  voicePackageLastPaid: { 
    type: Date 
  },

  voiceSettings: {
    stability: { type: Number, default: 0.5 },
    similarityBoost: { type: Number, default: 0.75 },
    style: { type: Number, default: 0.0 },
    useSpeakerBoost: { type: Boolean, default: true }
  },
}, { 
  timestamps: true,
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
});

// TTL Index for unverified accounts
agentSchema.index({ createdAt: 1 }, { 
  expireAfterSeconds: 86400, 
  partialFilterExpression: { isVerified: false } 
});

// Virtual for Main Plan Expiry
agentSchema.virtual('isExpired').get(function() {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

// Virtual for Voice Package Logic
agentSchema.virtual('isVoicePackageExpired').get(function() {
  // If they are using natural voice, it never expires
  if (!this.voiceId) return false;
  
  if (!this.voicePackageExpiry) return true; 
  return new Date() > this.voicePackageExpiry;
});

const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;