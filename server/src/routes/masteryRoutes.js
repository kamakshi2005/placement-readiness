import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import SkillMastery from '../models/SkillMastery.js';
import { recomputeMastery } from '../services/mastery/masteryService.js';
import { MASTERED_AT } from '../config/mastery.js';

const router = Router();
router.use(protect);

// GET /api/mastery — the student's skills, weakest first. ?refresh=1 recomputes first.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.query.refresh) await recomputeMastery(req.user._id);
    const skills = await SkillMastery.find({ user: req.user._id }).select('-params').sort({ p: 1 }).lean();
    res.json({ masteredAt: MASTERED_AT, skills });
  })
);

export default router;
