import mongoose from 'mongoose';

export const agentSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  // ADDED select: false for better security
  password: { type: String, required: true, select: false }, 
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

const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);

export default Agent;