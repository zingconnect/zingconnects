import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const AdminSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  // Added Email Field for Admin Identification
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

// --- PASSWORD HASHING MIDDLEWARE ---
// Removed 'next' parameter to fix "next is not a function" error in async hooks
AdminSchema.pre('save', async function() {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    // Finishing the async function acts as calling next()
  } catch (err) {
    // Throwing an error stops the save process and passes it to the catch block
    throw new Error(err);
  }
});

AdminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Serverless compatibility check for environments like Vercel
const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);

export default Admin;