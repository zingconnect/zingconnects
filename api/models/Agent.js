import mongoose from 'mongoose';

const agentSchema = new mongoose.Schema({
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
  photoUrl: { type: String, default: '' } // To store the uploaded image path later
}, { timestamps: true });

export const Agent = mongoose.model('Agent', agentSchema);