import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const AdminSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  password: { type: String, required: true },
  role: { 
    type: String, 
    default: 'superadmin', 
    enum: ['superadmin', 'support', 'editor'] 
  },
  lastLogin: { type: Date }
}, { timestamps: true });

AdminSchema.pre('save', async function(next) { // <--- add next
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

AdminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Serverless compatibility check for environments like Vercel
const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

export default Admin;