const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const AdminSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    default: 'superadmin', 
    enum: ['superadmin', 'support', 'editor'] 
  },
  lastLogin: { type: Date }
}, { timestamps: true });

// --- PASSWORD HASHING MIDDLEWARE ---
AdminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// --- HELPER METHOD TO CHECK PASSWORD ---
AdminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// CHANGE THIS LINE:
const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);
export default Admin;