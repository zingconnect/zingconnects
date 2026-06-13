import mongoose from 'mongoose';


const preKeySchema = new mongoose.Schema({
  keyId: { type: Number, required: true },
  publicKey: { type: String, required: true }
}, { _id: false });

const jwkSchema = new mongoose.Schema({
  registrationId: { type: Number, required: true },
  identityKey: { type: String, required: true },
  signedPreKey: { 
    keyId: { type: Number, required: true },
    publicKey: { type: String, required: true },
    signature: { type: String, required: true } 
  },
  preKeys: [preKeySchema]
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true, 
    lowercase: true,
    trim: true,
    index: true // 👈 Added: Faster lookups during login/auth
  },
  // --- PROFILE FIELDS ---
  firstName: {
    type: String,
    trim: true,
    default: ""
  },
  lastName: {
    type: String,
    trim: true,
    default: ""
  },
  dob: {
    type: String, 
    default: ""
  },
  gender: {
    type: String,
    lowercase: true,
    trim: true,
    enum: ['male', 'female', 'other', 'prefer-not-to-say', ''], 
    default: ""
  },
  city: {
    type: String,
    trim: true,
    default: ""
  },
  state: {
    type: String,
    trim: true,
    default: ""
  },
  pushSubscription: {
    type: Object,
    default: null
  },
  photoUrl: {
    type: String,
    default: ""
  },
publicKeyJwk: {
    type: jwkSchema,
    default: null
  },
  role: { 
    type: String, 
    default: 'user' // 👈 Added: Simplifies callerModel logic in controllers
  },
  isProfileComplete: {
    type: Boolean,
    default: false 
  },
  isVerified: {
    type: Boolean,
    default: false,
    index: true // 👈 Added: Useful for filtering verified users in search
  },
  phone: {
    raw: { type: String, trim: true, default: "" },         // e.g., "13232323232"
    formatted: { type: String, trim: true, default: "" },   // e.g., "+1 (323) 232-3232"
    countryCode: { type: String, trim: true, default: "" }, // e.g., "us"
    dialCode: { type: String, trim: true, default: "" }     // e.g., "1"
  },
  lastActive: { 
    type: Date, 
    default: Date.now 
  },
lastNotificationEmail: {
  type: Date,
  default: null
},
  connectedAgents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  }],
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, { 
  timestamps: true 
});

// Compound index for profile searches or directory listings
userSchema.index({ firstName: 1, lastName: 1 });
userSchema.virtual('isCryptoReady').get(function() {
  return !!(this.publicKeyJwk && 
            this.publicKeyJwk.identityKey && 
            this.publicKeyJwk.preKeys?.length > 0);
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;