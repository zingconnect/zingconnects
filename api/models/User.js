import mongoose from 'mongoose'; 

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true, // <--- This already creates the index!
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
    type: String, 
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
    default: false 
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

// REMOVED: userSchema.index({ email: 1 }); <--- DELETE THIS LINE

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;