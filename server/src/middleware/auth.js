import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Requires a valid "Authorization: Bearer <token>" header; puts the user on req.user
export async function protect(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Not logged in' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Load the user fresh, so a deleted user or changed role takes effect immediately
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Use after protect: requireRole('admin')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have access to this' });
    }
    next();
  };
}
