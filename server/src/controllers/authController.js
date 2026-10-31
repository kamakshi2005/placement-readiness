import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function sendAuth(res, status, user) {
  res.status(status).json({ token: signToken(user), user });
}

// POST /api/auth/signup  — always creates a student (admins come from the seed script)
export async function signup(req, res) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name) return res.status(400).json({ message: 'Name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Enter a valid email' });
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }

  if (await User.exists({ email })) {
    return res.status(409).json({ message: 'An account with this email already exists' });
  }

  const user = await User.create({ name, email, password, role: 'student' });
  sendAuth(res, 201, user);
}

// POST /api/auth/login
export async function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const user = await User.findOne({ email }).select('+password');
  // Same message for "no such email" and "wrong password", so attackers can't
  // find out which emails are registered
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  sendAuth(res, 200, user);
}

// GET /api/auth/me  (protected)
export function me(req, res) {
  res.json({ user: req.user });
}
