import mongoose from 'mongoose';

// One answer = one row of the evaluation data set. It copies the question's metadata
// (skills, difficulty, phase, attempt) so per-skill analysis and CSV export need no joins.
// Module 4 will add the rubric scores to this same document.
const answerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewSession', required: true },
    analysis: { type: mongoose.Schema.Types.ObjectId, ref: 'Analysis', required: true },
    questionIndex: { type: Number, required: true },

    category: { type: String, enum: ['technical', 'project', 'hr'], required: true },
    skills: [String],
    canonicalSkills: { type: [String], index: true },
    skillSource: String,
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'] },
    phase: { type: String, enum: ['baseline', 'practice', 'posttest'], required: true },
    mode: String,
    studyGroup: { type: String, enum: ['A', 'B', null], default: null },
    attemptNumber: { type: Number, required: true },

    text: { type: String, default: '' },
    // answered  = submitted in time
    // skipped   = student pressed Skip, or submitted an empty answer
    // timed_out = timer ran out (any text typed so far is kept)
    // not_reached = interview abandoned before this question
    // Module 4 scores everything except "answered" as 0.
    status: { type: String, enum: ['answered', 'skipped', 'timed_out', 'not_reached'], required: true },

    shownAt: Date,
    submittedAt: Date,
    timeTakenSec: Number,
    timeLimitSec: Number,
  },
  { timestamps: true }
);

// One answer per question — a double submit fails instead of creating a duplicate
answerSchema.index({ session: 1, questionIndex: 1 }, { unique: true });

export default mongoose.model('Answer', answerSchema);
