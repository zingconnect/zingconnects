import mongoose from 'mongoose';

// Export the schema separately so the connection object can use it
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
    default: false // Accounts are "Unpaid" by default
  },
  status: { 
    type: String, 
    enum: ['active', 'suspended', 'pending'], 
    default: 'active' 
  },
  
  // Optional: Track when the subscription started or ends
  subscriptionId: { type: String, default: '' }, 
  currentPeriodEnd: { type: Date }

}, { timestamps: true });

// Check if the model exists before creating it (prevents Vercel re-compilation errors)
export const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);