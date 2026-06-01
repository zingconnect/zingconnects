import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
    index: true
  },
  transactionId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  txRef: { 
    type: String, 
    required: true 
  },
  plan: {
    type: String,
    enum: ['BASIC', 'GROWTH', 'PROFESSIONAL'],
    required: true
  },
  months: { 
    type: Number, 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  currency: { 
    type: String, 
    default: 'NGN' 
  },
  status: { 
    type: String, 
    enum: ['successful', 'failed', 'reversed'], 
    default: 'successful' 
  },
  paidAt: { 
    type: Date, 
    default: Date.now 
  }
}, { 
  timestamps: true,
  bufferCommands: false 
});

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
export default Transaction;