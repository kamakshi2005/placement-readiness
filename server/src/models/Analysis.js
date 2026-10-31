import mongoose from 'mongoose';

// One resume + JD comparison. Everything needed to explain (and later reproduce) the
// result is stored: skill lists, per-skill decisions, and the exact models/thresholds used.

const skillResultSchema = new mongoose.Schema(
  {
    jdSkill: { type: String, required: true },
    canonical: String,
    importance: { type: String, enum: ['required', 'nice_to_have'], required: true },
    status: { type: String, enum: ['matched', 'partial', 'missing'], required: true },
    // how the decision was made: exact text, alias map, embedding threshold, or LLM judge
    method: { type: String, enum: ['exact', 'alias', 'embedding', 'llm'], required: true },
    resumeSkill: String, // the resume skill it matched (or the closest one, if missing)
    similarity: Number, // cosine similarity, 1 for exact/alias
    reason: String, // LLM judge's reason (borderline cases only)
  },
  { _id: false }
);

const analysisSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jdTitle: { type: String, trim: true, maxlength: 150 },
    jdText: { type: String, required: true },
    resumeFileName: String,
    resumeText: { type: String, required: true }, // REDACTED text only — the raw PDF is not kept
    redactions: { emails: Number, urls: Number, phones: Number, names: Number },

    resumeSkills: [String],
    jdSkills: [{ _id: false, name: String, importance: String }],
    results: [skillResultSchema],

    matchScore: { type: Number, min: 0, max: 100 }, // weighted per-skill score (main score)
    docSimilarity: Number, // whole-resume vs whole-JD cosine (shown for comparison only)

    // Reproducibility: what produced this result
    config: {
      genModel: String,
      embedModel: String,
      embedDims: Number,
      promptVersion: String,
      thresholds: { high: Number, low: Number },
      weights: { required: Number, nice_to_have: Number },
    },
    cacheHits: { resumeSkills: Boolean, jdSkills: Boolean },
  },
  { timestamps: true }
);

analysisSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model('Analysis', analysisSchema);
