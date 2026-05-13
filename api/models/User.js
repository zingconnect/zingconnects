import mongoose from 'mongoose';

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
  // --- STATUS & ROLE ---
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
    type: String,
    trim: true
  },
  lastActive: { 
    type: Date, 
    default: Date.now 
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

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;