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
  isVerified: { type: Boolean, default: false, index: true }, 
  otp: { type: String },
  otpExpires: { type: Date },

  lastActive: { type: Date, default: Date.now },
  pushSubscription: {
    type: Object,
    default: null
  },
lastNotificationEmail: {
  type: Date,
  default: null
},
publicKeyJwk: {
  identityKey: { type: String, required: false }, // Store as Base64 string
  signedPreKey: { 
    keyId: { type: Number, required: false },
    publicKey: { type: String, required: false }, // Store as Base64 string
    signature: { type: String, required: false } 
  },
  preKeys: [{
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true } // Store as Base64 string
  }]
},
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
  bufferCommands: false, // ✨ CRITICAL: Kills the 10s buffering hang on uninitialized instances
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


// ✨ FIXED: Added early validation guard clauses to prevent registration loop crashes
agentSchema.pre('validate', async function() {
  if (!this.firstName || !this.lastName) return; // Prevent loop execution if base names aren't present yet

  if (this.isModified('firstName') || this.isModified('lastName') || !this.slug) {
    const baseSlug = `${this.firstName}-${this.lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') 
      .replace(/(^-|-$)+/g, '');   

    let generatedSlug = baseSlug;
    let counter = 1;

    // Direct model fallback check protects database access during server instantiations
    const AgentModel = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

    while (true) {
      const existingAgent = await AgentModel.findOne({ 
        slug: generatedSlug, 
        _id: { $ne: this._id } 
      });

      if (!existingAgent) {
        break; 
      }

      generatedSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    this.slug = generatedSlug;
  }
});


const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;