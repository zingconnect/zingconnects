import mongoose from 'mongoose'; 

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true, 
    lowercase: true,
    trim: true
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
  // --- ADDED GENDER FIELD ---
  gender: {
    type: String,
    lowercase: true,
    trim: true,
    enum: ['male', 'female', 'other', 'prefer-not-to-say', ''], // Validates allowed values
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

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;