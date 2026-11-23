import mongoose from 'mongoose';

// One question inside a session. The plan part (category, skills, source, difficulty) is
// decided in code; the text and reference answer come from the LLM.
const questionSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    category: { type: String, enum: ['technical', 'project', 'hr'], required: true },
    skills: [String], // JD skill names this question tests (display form)
    canonicalSkills: [String], // normalized names, used to group scores per skill
    // why these skills were chosen: a gap (missing/partial), a resume claim (matched),
    // general mode, the student's projects, or HR
    skillSource: { type: String, enum: ['missing', 'partial', 'matched', 'general', 'resume', 'hr'], required: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true },
    timeLimitSec: { type: Number, required: true },
    text: { type: String, required: true },
    // Reference answer + key points for scoring. NEVER sent during the interview:
    // select:false hides it from queries, and the controller also strips it.
    // Key points have stable ids (k1, k2, …) so every scoring run, evaluation and
    // hand-label refers to the same point even when the order is shuffled.
    // (Sessions created before Phase 1 stored keyPoints as plain strings — see normalizeKeyPoints.)
    reference: {
      type: {
        answer: String,
        keyPoints: [mongoose.Schema.Types.Mixed], // [{ id: 'k1', text: '…' }]
      },
      select: false,
    },
    shownAt: Date, // set the first time the server sends this question (timer start)
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    analysis: { type: mongoose.Schema.Types.ObjectId, ref: 'Analysis', required: true },

    // Study design: everyone does the same baseline (gap) and post-test; only practice differs.
    phase: { type: String, enum: ['baseline', 'practice', 'posttest'], required: true },
    // gap = weighted towards JD gaps, general = JD skills picked evenly,
    // targeted / retest = Module 5
    mode: { type: String, enum: ['gap', 'general', 'targeted', 'retest'], required: true },
    studyGroup: { type: String, enum: ['A', 'B', null], default: null }, // snapshot at start
    preset: { type: String, required: true },
    counts: { technical: Number, project: Number, hr: Number },
    attemptNumber: { type: Number, required: true }, // 1 = this student's first interview

    status: { type: String, enum: ['in_progress', 'completed', 'abandoned'], default: 'in_progress' },
    currentIndex: { type: Number, default: 0 },
    questions: [questionSchema],
    completedAt: Date,

    // Background scoring progress (Phase 1). none -> pending -> running -> done | failed,
    // or waiting_quota (not enough daily AI quota; retried every 15 min / after the reset)
    scoring: {
      status: { type: String, enum: ['none', 'pending', 'running', 'waiting_quota', 'done', 'failed'], default: 'none' },
      total: Number, // answers to score
      done: { type: Number, default: 0 },
      startedAt: Date,
      finishedAt: Date,
      error: String, // failure details, or the waiting-for-quota message
    },
    // First time the student viewed the scored results. The results list the key points
    // (incl. missing ones), which already reveals the gist of the model answers — later
    // phases should treat repeat questions after this date as "seen", like referenceShown.
    resultsViewedAt: Date,

    config: {
      genModel: String, // requested model for question writing
      questionModelVersion: String, // model version that actually answered
      repair: mongoose.Schema.Types.Mixed, // multi-part repair call: model, flagged, rewritten
      promptVersion: String,
      temperature: Number,
      gapShare: Number,
      timeLimits: { technical: Number, project: Number, hr: Number },
      graceSec: Number,
    },
  },
  { timestamps: true }
);

interviewSessionSchema.index({ user: 1, createdAt: -1 });
// At most ONE in-progress interview per student (also protects against double-clicks)
interviewSessionSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { status: 'in_progress' }, name: 'one_in_progress_per_user' }
);

export default mongoose.model('InterviewSession', interviewSessionSchema);
