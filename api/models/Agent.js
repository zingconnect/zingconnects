import mongoose from 'mongoose';
import { agentDb } from '../index.js'; // Import the specific connection

const agentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // Slug is the unique part of the URL: zingconnect.com/john-doe
  slug: { type: String, required: true, unique: true, lowercase: true },
  role: { type: String, enum: ['agent', 'consultant', 'owner'], default: 'agent' },
  subscriptionStatus: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
  isOnline: { type: Boolean, default: false }
}, { timestamps: true });

export const Agent = agentDb.model('Agent', agentSchema);