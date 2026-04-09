const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // The primary identifier for the user
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  
  // This array stores the IDs of Agents the user has "shaken hands" with
  // 'ref' must match the name you used in mongoose.model('Agent', ...)
  connectedAgents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  }],

  // Tracking for the Agent's "Recently Active" sidebar sorting
  lastLogin: {
    type: Date,
    default: Date.now
  },

  // Optional: metadata for analytics
  isVerified: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true // Automatically creates createdAt and updatedAt fields
});

// Indexing the email for lightning-fast lookups during handshake
userSchema.index({ email: 1 });

const User = mongoose.model('User', userSchema);
module.exports = User;