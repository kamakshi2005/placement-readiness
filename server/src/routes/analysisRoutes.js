import { Router } from 'express';
import multer from 'multer';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createAnalysis, listAnalyses, getAnalysis } from '../controllers/analysisController.js';

// Keep the upload in memory: we only need its text, the file itself is never saved
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    const err = new Error('Only PDF files are allowed');
    err.status = 400;
    cb(err);
  },
});

// Turn multer errors (e.g. file too large) into clean 400 responses
function uploadResume(req, res, next) {
  upload.single('resume')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'PDF is too large (max 2 MB)' });
    res.status(err.status || 400).json({ message: err.message });
  });
}

const router = Router();
router.use(protect); // every analysis route needs a logged-in user

router.post('/', uploadResume, asyncHandler(createAnalysis));
router.get('/', asyncHandler(listAnalyses));
router.get('/:id', asyncHandler(getAnalysis));

export default router;
