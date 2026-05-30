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
    index: true 
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
  isVerified: { type: Boolean, default: false, index: true }, 
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
  if (!this.voiceId) return false;
  if (!this.voicePackageExpiry) return true; 
  return new Date() > this.voicePackageExpiry;
});

// ✨ FIXED: Removed 'next' parameter since this is an async function
agentSchema.pre('validate', async function() {
  if (this.isModified('firstName') || this.isModified('lastName') || !this.slug) {
    // 1. Create baseline slug string format (e.g., "john-doe")
    const baseSlug = `${this.firstName}-${this.lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // replace spaces/special characters with hyphens
      .replace(/(^-|-$)+/g, '');   // trim trailing hyphens

    let generatedSlug = baseSlug;
    let counter = 1;

    // 2. Loop check to guarantee absolute uniqueness in database collection
    while (true) {
      const existingAgent = await mongoose.models.Agent.findOne({ 
        slug: generatedSlug, 
        _id: { $ne: this._id } 
      });

      if (!existingAgent) {
        break; // Found an available slug!
      }

      // If slug exists, attach index counter (e.g., "john-doe-1", "john-doe-2")
      generatedSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = generatedSlug;
  }
  // No next() call here. Returning or resolving the async function tells Mongoose to proceed.
});

const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;