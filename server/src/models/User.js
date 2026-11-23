import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // select: false -> the hash is never returned by queries unless asked for explicitly
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    // Evaluation study group, set by an admin. null = not in the study (free practice).
    // A = general-mode practice, B = targeted practice (Module 5).
    studyGroup: { type: String, enum: ['A', 'B', null], default: null },
  },
  { timestamps: true }
);

// Hash the password whenever it is set or changed (never store plain text)
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10); // 10 salt rounds
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Safety net: strip the hash if a user document is ever sent as JSON
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
