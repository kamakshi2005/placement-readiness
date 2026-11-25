import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import analysisRoutes from './routes/analysisRoutes.js';
import interviewRoutes from './routes/interviewRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import masteryRoutes from './routes/masteryRoutes.js';
import { resumePendingScoring } from './services/scoring/evaluateSession.js';

// Tokens can't be signed or checked without a secret, so refuse to start
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set in server/.env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'not connected',
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mastery', masteryRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ message: 'Route not found' }));

// central error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err); // 4xx are expected user errors, not worth a stack trace
  res.status(status).json({
    message: status >= 500 && !err.status ? 'Server error' : err.message,
    ...(err.sessionId && { sessionId: err.sessionId }), // e.g. "interview already in progress"
  });
});

connectDB().then((connected) => {
  // continue any interview scoring that was interrupted by a restart
  if (connected) {
    const resume = () => resumePendingScoring().catch((e) => console.error('[scoring] resume check failed', e.message));
    resume();
    // also picks up sessions waiting for the daily AI quota to reset
    setInterval(resume, 15 * 60 * 1000).unref();
  }
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
});
