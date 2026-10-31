// Creates (or resets) the admin account.
// Usage: set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD in .env, then: npm run seed:admin
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

const { MONGO_URI, ADMIN_NAME = 'Admin', ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

if (!MONGO_URI || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set MONGO_URI, ADMIN_EMAIL and ADMIN_PASSWORD in server/.env first.');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

await mongoose.connect(MONGO_URI);

const email = ADMIN_EMAIL.trim().toLowerCase();
let user = await User.findOne({ email });
if (user) {
  user.role = 'admin';
  user.password = ADMIN_PASSWORD; // re-hashed by the pre-save hook
  await user.save();
  console.log(`✅ Existing user ${email} is now admin (password reset).`);
} else {
  await User.create({ name: ADMIN_NAME, email, password: ADMIN_PASSWORD, role: 'admin' });
  console.log(`✅ Admin ${email} created.`);
}

await mongoose.disconnect();
