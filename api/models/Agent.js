import mongoose from 'mongoose';

export const agentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  address: String,
  occupation: String,
  program: String,
  bio: String,
  dob: Date,
  gender: String,
  role: { type: String, default: 'agent' },
  photoUrl: { type: String, default: '' },

  // --- SUBSCRIPTION & PAYMENT FIELDS ---
  plan: { 
    type: String, 
    enum: ['BASIC', 'PRO', 'ENTERPRISE'], 
    default: 'BASIC' 
  },
  isSubscribed: { 
    type: Boolean, 
    default: false 
  },
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'pending'], 
    default: 'active' 
  },
  
  subscriptionId: { type: String, default: '' }, 
  currentPeriodEnd: { type: Date }
}, { timestamps: true });

// 1. Define the model constant
const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

// 2. Export as default (This fixes the index.js boot error)
export default Agent;