import mongoose from 'mongoose';

// Latest mastery snapshot per student per skill (Phase 2). It is always RE-COMPUTED from the
// Answer records (services/mastery/masteryService.js), so changing a parameter and recomputing
// gives consistent values; this collection is a cache + the "why" log for the UI.
const skillMasterySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    skill: { type: String, required: true }, // canonical name (Module 2 alias map), e.g. "node.js"
    name: String, // display name, e.g. "Node.js"
    prior: Number,
    priorSource: String, // missing | partial | matched | unknown
    p: Number, // P(mastered), continuous evidence model
    range: { low: Number, high: Number }, // middle 80 % over plausible parameters
    pThreshold: Number, // baseline: same evidence, score ≥ 60 = correct
    status: { type: String, enum: ['not_yet', 'developing', 'mastered'] },
    answers: Number, // evidence items
    uncertainAnswers: Number, // evidence items with scoring confidence < 0.9
    evidence: [
      {
        _id: false,
        answer: mongoose.Schema.Types.ObjectId,
        session: mongoose.Schema.Types.ObjectId,
        questionIndex: Number,
        question: String,
        status: String,
        score: Number,
        weight: Number,
        weightParts: { confidence: Number, share: Number, skipped: Number, repeat: Number },
        learnBefore: Boolean,
        pBefore: Number,
        pAfter: Number,
        at: Date,
      },
    ],
    params: mongoose.Schema.Types.Mixed, // the settings used (for reproducibility)
  },
  { timestamps: true }
);
skillMasterySchema.index({ user: 1, skill: 1 }, { unique: true });

export default mongoose.model('SkillMastery', skillMasterySchema);
