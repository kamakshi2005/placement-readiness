import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  startInterview,
  getCurrent,
  submitAnswer,
  abandonInterview,
  listInterviews,
  getInterview,
} from '../controllers/interviewController.js';

const router = Router();
router.use(protect);

router.post('/', asyncHandler(startInterview));
router.get('/', asyncHandler(listInterviews));
router.get('/:id', asyncHandler(getInterview));
router.get('/:id/current', asyncHandler(getCurrent));
router.post('/:id/answer', asyncHandler(submitAnswer));
router.post('/:id/abandon', asyncHandler(abandonInterview));

export default router;
