import mongoose from 'mongoose'; 

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  // --- NEW PROFILE FIELDS ---
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
    type: String, // Storing as string from date input
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
  photoUrl: {
    type: String,
    default: ""
  },
  // --- STATUS FLAGS ---
  isProfileComplete: {
    type: Boolean,
    default: false // This triggers the onboarding overlay on the frontend
  },
  isVerified: {
    type: Boolean,
    default: false
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

userSchema.index({ email: 1 });

// Ensure we don't re-compile the model if it already exists (Vercel/Hot Reloading safety)
const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;