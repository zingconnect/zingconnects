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
  plan: { type: String, default: 'BASIC' },
  role: { type: String, default: 'agent' },
  photoUrl: { type: String, default: '' }
}, { timestamps: true });

// This default export is still fine for global use, 
// but server.js will now use agentSchema specifically.
export const Agent = mongoose.model('Agent', agentSchema);