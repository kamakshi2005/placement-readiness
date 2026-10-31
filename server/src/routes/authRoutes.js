import { Router } from 'express';
import { signup, login, me } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/signup', asyncHandler(signup));
router.post('/login', asyncHandler(login));
router.get('/me', protect, me);

export default router;
