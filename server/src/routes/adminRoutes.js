import { Router } from 'express';
import mongoose from 'mongoose';
import { protect, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.js';
import InterviewSession from '../models/InterviewSession.js';
import { MODEL_LIMITS } from '../config/models.js';
import { usageReport, dayKey, resetInWords } from '../services/aiQuota.js';
import { llmMode } from '../services/llmRecorder.js';

const router = Router();
router.use(protect, requireRole('admin')); // every route here is admin-only

// GET /api/admin/users — students with their study group and interview progress
router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await User.find({ role: 'student' }).sort({ createdAt: 1 }).lean();
    const stats = await InterviewSession.aggregate([
      { $group: { _id: { user: '$user', phase: '$phase', status: '$status' }, n: { $sum: 1 } } },
    ]);
    const count = (id, phase) =>
      stats.filter((s) => s._id.user.equals(id) && s._id.phase === phase && s._id.status === 'completed').reduce((t, s) => t + s.n, 0);
    res.json({
      users: users.map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        studyGroup: u.studyGroup ?? null,
        createdAt: u.createdAt,
        completed: { baseline: count(u._id, 'baseline'), practice: count(u._id, 'practice'), posttest: count(u._id, 'posttest') },
      })),
    });
  })
);

// GET /api/admin/ai-usage — today's requests per AI model vs its free-tier daily limit
router.get(
  '/ai-usage',
  asyncHandler(async (req, res) => {
    res.json({ day: dayKey(), resetsIn: resetInWords(), mode: llmMode(), models: await usageReport(Object.keys(MODEL_LIMITS)) });
  })
);

// PATCH /api/admin/users/:id/study-group  { studyGroup: 'A' | 'B' | null }
router.patch(
  '/users/:id/study-group',
  asyncHandler(async (req, res) => {
    const { studyGroup } = req.body;
    if (![null, 'A', 'B'].includes(studyGroup)) return res.status(400).json({ message: 'studyGroup must be "A", "B" or null' });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'User not found' });
    const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'student' }, { studyGroup }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  })
);

export default router;
