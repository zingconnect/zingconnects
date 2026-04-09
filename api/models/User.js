// 1. CHANGE THIS
import mongoose from 'mongoose'; 

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  connectedAgents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  }],
  lastLogin: {
    type: Date,
    default: Date.now
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true 
});

userSchema.index({ email: 1 });

// 2. CHECK IF MODEL EXISTS AND CHANGE THE EXPORT
const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User; 