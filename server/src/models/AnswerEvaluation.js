import mongoose from 'mongoose';

// One scoring of one answer. Re-scoring (new prompt, new model) creates a NEW version instead
// of overwriting, so scores can be compared over time. Answer.evaluation points to the latest.

const spanSchema = new mongoose.Schema(
  {
    start: Number, // character offsets in the answer text: answer.slice(start, end)
    end: Number,
    text: String,
    matchType: { type: String, enum: ['exact', 'normalized', 'fuzzy'] },
  },
  { _id: false }
);

const runSchema = new mongoose.Schema(
  {
    variant: { type: String, enum: ['A', 'B', 'C'] }, // which rubric wording was used
    model: String, // which model scored this run (requested name; fallbackFrom if it was a fallback)
    modelVersion: String, // the version Google reported for the response
    fallbackFrom: String,
    kpOrder: [String], // key-point ids in the order shown to the AI
    keyPoints: [{ _id: false, id: String, label: String }],
    correctness: Number, // 0–4
    depth: Number,
    clarity: Number,
    coverage: Number, // 0–1, computed from the labels
    overall: Number, // 0–100
    quotes: { returned: Number, verified: Number, fuzzy: Number, dropped: Number },
    durationMs: Number,
    raw: mongoose.Schema.Types.Mixed, // the AI's JSON, kept for auditing
  },
  { _id: false }
);

const answerEvaluationSchema = new mongoose.Schema(
  {
    answer: { type: mongoose.Schema.Types.ObjectId, ref: 'Answer', required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewSession', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    questionIndex: Number,
    version: { type: Number, required: true }, // 1, 2, … per answer

    // auto = no AI call (skipped / not reached / empty answer -> 0)
    method: { type: String, enum: ['llm', 'auto'], required: true },
    autoReason: String,
    timedOut: Boolean, // the answer was cut off by the timer; its text was still scored

    // What the student was scored against (copied, so later edits can't change history)
    keyPointsUsed: [{ _id: false, id: String, text: String }],

    runs: [runSchema],

    // Aggregated result
    keyPoints: [
      {
        _id: false,
        id: String,
        text: String,
        label: { type: String, enum: ['covered', 'partial', 'missing'] },
        votes: { covered: Number, partial: Number, missing: Number },
        unresolved: Boolean, // no label had a majority
        evidence: [spanSchema],
      },
    ],
    errorSpans: [ // not "errors": that name is reserved by Mongoose documents
      {
        _id: false,
        ...spanSchema.obj,
        explanation: String,
        votes: Number, // how many runs quoted (overlapping) text as an error
        accepted: Boolean, // quoted by a majority of runs -> highlighted and counted
      },
    ],
    dimensions: {
      coverage: { value: Number, min: Number, max: Number }, // 0–1
      correctness: { value: Number, min: Number, max: Number }, // 0–4 (median of runs)
      depth: { value: Number, min: Number, max: Number },
      clarity: { value: Number, min: Number, max: Number },
    },
    score: Number, // 0–100, from the aggregated components
    scoreMin: Number, // range across runs
    scoreMax: Number,
    uncertain: Boolean,
    uncertainReasons: [String],
    manipulationFlags: [String], // phrases addressed to the examiner (scoring/manipulation.js)

    feedback: {
      strengths: [String],
      improvements: [String],
      jdGaps: [String], // "This job asks for X — your answer didn't show: …"
    },
    refSimilarity: Number, // embedding cosine to the reference answer (reported, not scored)
    quoteStats: { returned: Number, verified: Number, fuzzy: Number, dropped: Number },

    config: {
      genModel: String, // (auto evaluations only)
      runModels: { A: String, B: String, C: String }, // primary model per rubric variant
      embedModel: String,
      promptVersion: String,
      temperature: Number,
      weights: { coverage: Number, correctness: Number, depth: Number, clarity: Number },
      minRuns: Number,
      maxRuns: Number,
      thirdRunScoreGap: Number,
      uncertainRange: Number,
    },
  },
  { timestamps: true }
);

answerEvaluationSchema.index({ answer: 1, version: 1 }, { unique: true });

export default mongoose.model('AnswerEvaluation', answerEvaluationSchema);
