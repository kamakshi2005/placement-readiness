import mongoose from 'mongoose';
import Analysis from '../models/Analysis.js';
import { pdfToText } from '../services/pdf.js';
import { runAnalysis } from '../services/analysisService.js';
import { normalizeText } from '../utils/normalizeText.js';

// POST /api/analysis  (multipart form: resume = PDF file, jdText, jdTitle)
export async function createAnalysis(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Please upload your resume as a PDF' });
  // Check the file really is a PDF (the "%PDF-" signature), not just named .pdf
  if (req.file.buffer.subarray(0, 5).toString() !== '%PDF-') {
    return res.status(400).json({ message: 'That file is not a valid PDF' });
  }

  const jdText = normalizeText(req.body.jdText);
  const jdTitle = String(req.body.jdTitle || '').trim().slice(0, 150);
  if (jdText.length < 100) {
    return res.status(400).json({ message: 'Paste the full job description (at least 100 characters)' });
  }
  if (jdText.length > 20000) {
    return res.status(400).json({ message: 'Job description is too long (max 20,000 characters)' });
  }

  const resumeText = await pdfToText(req.file.buffer);
  const analysis = await runAnalysis({
    user: req.user,
    resumeText,
    resumeFileName: req.file.originalname,
    jdText,
    jdTitle,
  });
  res.status(201).json({ analysis });
}

// GET /api/analysis  — the logged-in user's analyses, newest first (summary only)
export async function listAnalyses(req, res) {
  const analyses = await Analysis.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .select('jdTitle matchScore resumeFileName createdAt results.status')
    .lean();

  res.json({
    analyses: analyses.map(({ results, ...a }) => ({
      ...a,
      counts: {
        matched: results.filter((r) => r.status === 'matched').length,
        partial: results.filter((r) => r.status === 'partial').length,
        missing: results.filter((r) => r.status === 'missing').length,
      },
    })),
  });
}

// GET /api/analysis/:id  — owner or admin only
export async function getAnalysis(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Analysis not found' });
  const analysis = await Analysis.findById(req.params.id);
  // Same 404 for "doesn't exist" and "not yours", so ids of other users' analyses don't leak
  if (!analysis || (!analysis.user.equals(req.user._id) && req.user.role !== 'admin')) {
    return res.status(404).json({ message: 'Analysis not found' });
  }
  res.json({ analysis });
}
