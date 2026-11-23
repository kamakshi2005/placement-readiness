import mongoose from 'mongoose';
import Analysis from '../models/Analysis.js';
import InterviewSession from '../models/InterviewSession.js';
import Answer from '../models/Answer.js';
import { PRESETS, TIME_LIMITS, GRACE_SEC, GAP_SHARE, MAX_ANSWER_CHARS } from '../config/interview.js';
import { buildPlan } from '../services/interviewPlanner.js';
import { generateQuestions, QUESTION_PROMPT_VERSION, QUESTION_TEMPERATURE } from '../services/questionGenerator.js';
import { modelInfo } from '../services/llm.js';
import AnswerEvaluation from '../models/AnswerEvaluation.js';
import { normalizeKeyPoints } from '../services/questionGenerator.js';
import { queueSessionScoring } from '../services/scoring/evaluateSession.js';

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// What the student may see of a question DURING the interview: no skills, no difficulty,
// and never the reference answer (so the test isn't given away).
const liveQuestion = (q) => ({ index: q.index, category: q.category, text: q.text, timeLimitSec: q.timeLimitSec });

async function loadOwnSession(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Interview not found');
  const s = await InterviewSession.findById(req.params.id); // reference answers excluded (select:false)
  if (!s || (!s.user.equals(req.user._id) && req.user.role !== 'admin')) throw httpError(404, 'Interview not found');
  return s;
}

/**
 * Save the answer for question `idx` and move the session to the next question.
 * Safe against double submits: the unique (session, questionIndex) index rejects a second
 * answer, and the session only advances if it is still on `idx`.
 */
async function recordAnswer(session, idx, { text, status }) {
  const q = session.questions[idx];
  const now = new Date();
  try {
    await Answer.create({
      user: session.user,
      session: session._id,
      analysis: session.analysis,
      questionIndex: idx,
      category: q.category,
      skills: q.skills,
      canonicalSkills: q.canonicalSkills,
      skillSource: q.skillSource,
      difficulty: q.difficulty,
      phase: session.phase,
      mode: session.mode,
      studyGroup: session.studyGroup,
      attemptNumber: session.attemptNumber,
      text: (text || '').slice(0, MAX_ANSWER_CHARS),
      status,
      shownAt: q.shownAt,
      submittedAt: status === 'not_reached' ? undefined : now,
      timeTakenSec: q.shownAt && status !== 'not_reached' ? Math.round((now - q.shownAt) / 1000) : undefined,
      timeLimitSec: q.timeLimitSec,
    });
  } catch (e) {
    // Answer already saved (e.g. crash between the two writes last time) -> just advance
    if (e.code !== 11000) throw e;
  }

  const last = idx === session.questions.length - 1;
  const update = last
    ? { $set: { currentIndex: idx + 1, status: 'completed', completedAt: now } }
    : { $set: { currentIndex: idx + 1 } };
  const res = await InterviewSession.updateOne({ _id: session._id, currentIndex: idx, status: 'in_progress' }, update);
  session.currentIndex = idx + 1;
  if (last) {
    session.status = 'completed';
    session.completedAt = now;
    // Phase 1: score the finished interview in the background (only the request that
    // actually completed it starts scoring, so a double submit can't start it twice)
    if (res.modifiedCount) queueSessionScoring(session._id);
  }
}

/**
 * Return the current question, starting its timer on first view. If the student was away
 * longer than the time limit (+ grace), the question is recorded as timed out and the next
 * one is served — so refreshing or leaving the page never resets or pauses the timer.
 */
async function currentPayload(session) {
  while (session.status === 'in_progress') {
    const idx = session.currentIndex;
    const q = session.questions[idx];
    const now = new Date();
    if (!q.shownAt) {
      q.shownAt = now;
      // targeted $set: never rewrite the whole questions array (it was loaded without references)
      await InterviewSession.updateOne(
        { _id: session._id, currentIndex: idx, [`questions.${idx}.shownAt`]: { $exists: false } },
        { $set: { [`questions.${idx}.shownAt`]: now } }
      );
    }
    const elapsed = (now - q.shownAt) / 1000;
    if (elapsed > q.timeLimitSec + GRACE_SEC) {
      await recordAnswer(session, idx, { text: '', status: 'timed_out' });
      continue;
    }
    return {
      status: 'in_progress',
      total: session.questions.length,
      question: liveQuestion(q),
      remainingSec: Math.max(0, Math.round(q.timeLimitSec - elapsed)),
    };
  }
  return { status: session.status, total: session.questions.length };
}

// POST /api/interviews  { analysisId, mode?, preset? }
export async function startInterview(req, res) {
  const { analysisId } = req.body;
  if (!mongoose.isValidObjectId(analysisId)) throw httpError(400, 'Choose an analysis to base the interview on');
  const analysis = await Analysis.findOne({ _id: analysisId, user: req.user._id });
  if (!analysis) throw httpError(404, 'Analysis not found');

  const open = await InterviewSession.findOne({ user: req.user._id, status: 'in_progress' }).select('_id');
  if (open) throw httpError(409, 'You already have an interview in progress. Finish or abandon it first.', { sessionId: open._id });

  // ---- Phase and mode (study design) ----
  // Everyone's first completed interview on an analysis is the BASELINE, in gap mode.
  // After that: Group A practises in general mode, Group B gets targeted practice (Module 5),
  // students outside the study choose freely. The post-test is started in Module 5.
  const group = req.user.studyGroup ?? null;
  const baselineDone = await InterviewSession.exists({
    user: req.user._id,
    analysis: analysis._id,
    phase: 'baseline',
    status: 'completed',
  });
  let phase, mode;
  if (!baselineDone) {
    phase = 'baseline';
    mode = 'gap';
  } else if (group === 'A') {
    phase = 'practice';
    mode = 'general';
  } else if (group === 'B') {
    throw httpError(409, 'Targeted practice for your study group is not available yet (coming in Module 5).');
  } else {
    phase = 'practice';
    mode = ['gap', 'general'].includes(req.body.mode) ? req.body.mode : 'gap';
  }
  // Study participants always get the short study preset, so both groups are comparable
  const preset = group ? 'study' : PRESETS[req.body.preset] ? req.body.preset : 'standard';

  // ---- Plan (code) + texts (LLM) ----
  const { plan, counts } = buildPlan({ analysis, mode, preset });
  const earlier = await InterviewSession.find({ user: req.user._id, analysis: analysis._id }).select('questions.text').lean();
  const previousQuestions = earlier.flatMap((s) => s.questions.map((q) => q.text)).slice(-30);

  const { questions: written, meta: qMeta } = await generateQuestions({ plan, analysis, previousQuestions });

  try {
    const session = await InterviewSession.create({
      user: req.user._id,
      analysis: analysis._id,
      phase,
      mode,
      studyGroup: group,
      preset,
      counts,
      attemptNumber: (await InterviewSession.countDocuments({ user: req.user._id })) + 1,
      questions: plan.map((p, i) => ({ ...p, text: written[i].text, reference: written[i].reference })),
      config: {
        genModel: modelInfo('questions').genModel,
        questionModelVersion: qMeta.modelVersion, // the model that actually wrote them
        ...(qMeta.repair && { repair: qMeta.repair }),
        promptVersion: QUESTION_PROMPT_VERSION,
        temperature: QUESTION_TEMPERATURE,
        gapShare: GAP_SHARE,
        timeLimits: TIME_LIMITS,
        graceSec: GRACE_SEC,
      },
    });
    res.status(201).json({ session: { _id: session._id, phase, mode, preset, total: session.questions.length } });
  } catch (e) {
    // unique "one in-progress interview" index: a second start raced this one
    if (e.code === 11000) throw httpError(409, 'You already have an interview in progress.');
    throw e;
  }
}

// GET /api/interviews/:id/current
export async function getCurrent(req, res) {
  const session = await loadOwnSession(req);
  res.json(await currentPayload(session));
}

// POST /api/interviews/:id/answer  { index, text, action: 'submit' | 'skip' | 'timeout' }
export async function submitAnswer(req, res) {
  const session = await loadOwnSession(req);
  if (!session.user.equals(req.user._id)) throw httpError(403, 'Only the student can answer their interview');
  if (session.status !== 'in_progress') throw httpError(409, 'This interview is already finished');

  const idx = Number(req.body.index);
  if (idx !== session.currentIndex) {
    // stale tab or double click: tell the client where the interview really is
    return res.status(409).json({ message: 'That question was already answered', current: await currentPayload(session) });
  }

  const q = session.questions[idx];
  const text = String(req.body.text ?? '');
  const elapsed = q.shownAt ? (Date.now() - q.shownAt) / 1000 : 0;

  let status;
  if (req.body.action === 'skip') status = 'skipped';
  else if (req.body.action === 'timeout' || elapsed > q.timeLimitSec + GRACE_SEC) status = 'timed_out';
  else status = text.trim() ? 'answered' : 'skipped';

  await recordAnswer(session, idx, { text, status });
  res.json({ recorded: status, ...(await currentPayload(session)) });
}

// POST /api/interviews/:id/abandon — remaining questions are stored as "not_reached"
export async function abandonInterview(req, res) {
  const session = await loadOwnSession(req);
  if (!session.user.equals(req.user._id)) throw httpError(403, 'Only the student can abandon their interview');
  if (session.status !== 'in_progress') throw httpError(409, 'This interview is already finished');

  for (let i = session.currentIndex; i < session.questions.length; i++) {
    await Answer.updateOne(
      { session: session._id, questionIndex: i },
      {
        $setOnInsert: {
          user: session.user, session: session._id, analysis: session.analysis, questionIndex: i,
          category: session.questions[i].category, skills: session.questions[i].skills,
          canonicalSkills: session.questions[i].canonicalSkills, skillSource: session.questions[i].skillSource,
          difficulty: session.questions[i].difficulty, phase: session.phase, mode: session.mode,
          studyGroup: session.studyGroup, attemptNumber: session.attemptNumber, text: '',
          status: 'not_reached', shownAt: session.questions[i].shownAt, timeLimitSec: session.questions[i].timeLimitSec,
        },
      },
      { upsert: true }
    );
  }
  const upd = await InterviewSession.updateOne({ _id: session._id, status: 'in_progress' }, { $set: { status: 'abandoned', completedAt: new Date() } });
  if (upd.modifiedCount) queueSessionScoring(session._id); // answered questions still get scored
  res.json({ status: 'abandoned' });
}

// GET /api/interviews/:id/results — scoring progress + per-answer evaluations + per-skill table
export async function getResults(req, res) {
  const session = await loadOwnSession(req);
  if (session.status === 'in_progress') throw httpError(409, 'The interview is still in progress');

  const answers = await Answer.find({ session: session._id }).sort({ questionIndex: 1 }).lean();
  const evalIds = answers.map((a) => a.evaluation).filter(Boolean);
  const evals = new Map(
    (await AnswerEvaluation.find({ _id: { $in: evalIds } }).select('-runs.raw').lean()).map((e) => [String(e._id), e])
  );

  const items = session.questions.map((q) => {
    const a = answers.find((x) => x.questionIndex === q.index);
    const e = a?.evaluation ? evals.get(String(a.evaluation)) : null;
    return {
      index: q.index,
      category: q.category,
      text: q.text,
      skills: q.skills,
      skillSource: q.skillSource,
      difficulty: q.difficulty,
      answer: a ? { text: a.text, status: a.status, timeTakenSec: a.timeTakenSec, referenceShown: a.referenceShown } : null,
      evaluation: e
        ? {
            method: e.method,
            autoReason: e.autoReason,
            timedOut: e.timedOut,
            score: e.score,
            scoreMin: e.scoreMin,
            scoreMax: e.scoreMax,
            uncertain: e.uncertain,
            uncertainReasons: e.uncertainReasons,
            confidence: e.confidence,
            keyPoints: e.keyPoints,
            errors: (e.errorSpans || []).filter((x) => x.accepted), // only majority-confirmed errors are shown
            dimensions: e.dimensions,
            feedback: e.feedback,
            refSimilarity: e.refSimilarity,
            runs: (e.runs || []).map((r) => ({ variant: r.variant, overall: r.overall })),
            version: e.version,
          }
        : null,
    };
  });

  // Per-skill summary: average score of the scored answers that tested each skill
  const skills = new Map();
  for (const it of items) {
    if (!it.evaluation) continue;
    for (const s of it.skills) {
      const row = skills.get(s) || { skill: s, scores: [], uncertain: false };
      row.scores.push(it.evaluation.score);
      row.uncertain ||= it.evaluation.uncertain;
      skills.set(s, row);
    }
  }
  const scored = items.filter((it) => it.evaluation);
  if (scored.length && session.user.equals(req.user._id) && !session.resultsViewedAt) {
    await InterviewSession.updateOne({ _id: session._id, resultsViewedAt: { $exists: false } }, { $set: { resultsViewedAt: new Date() } });
  }
  res.json({
    scoring: { status: session.scoring?.status || 'none', total: session.scoring?.total, done: session.scoring?.done, error: session.scoring?.error },
    overall: scored.length ? Math.round(scored.reduce((t, it) => t + it.evaluation.score, 0) / scored.length) : null,
    items,
    skills: [...skills.values()].map((r) => ({
      skill: r.skill,
      questions: r.scores.length,
      score: Math.round(r.scores.reduce((t, x) => t + x, 0) / r.scores.length),
      min: Math.min(...r.scores),
      max: Math.max(...r.scores),
      uncertain: r.uncertain,
    })),
  });
}

// POST /api/interviews/:id/answers/:index/reference — returns the model answer and records
// that the student saw it (referenceShown), so later phases can discount repeat questions.
export async function showReference(req, res) {
  const session = await loadOwnSession(req);
  if (session.status === 'in_progress') throw httpError(409, 'Model answers are shown after the interview');
  const idx = Number(req.params.index);
  const q = await InterviewSession.findById(session._id).select('+questions.reference').lean();
  const question = q?.questions?.[idx];
  if (!question) throw httpError(404, 'Question not found');

  // Only the student's own viewing counts (an admin looking doesn't mark it as seen)
  if (session.user.equals(req.user._id)) {
    await Answer.updateOne(
      { session: session._id, questionIndex: idx, referenceShown: { $ne: true } },
      { $set: { referenceShown: true, referenceShownAt: new Date() } }
    );
  }
  res.json({
    reference: { answer: question.reference?.answer || '', keyPoints: normalizeKeyPoints(question.reference?.keyPoints) },
  });
}

// GET /api/interviews — the student's interviews, newest first
export async function listInterviews(req, res) {
  const sessions = await InterviewSession.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .select('phase mode preset status attemptNumber currentIndex questions.index createdAt completedAt analysis')
    .populate('analysis', 'jdTitle')
    .lean();
  res.json({
    interviews: sessions.map(({ questions, analysis, ...s }) => ({
      ...s,
      jdTitle: analysis?.jdTitle,
      analysisId: analysis?._id,
      total: questions.length,
    })),
  });
}

// GET /api/interviews/:id — summary. Questions + answers only once the interview is over.
export async function getInterview(req, res) {
  const session = await loadOwnSession(req);
  const base = {
    _id: session._id,
    analysis: session.analysis,
    phase: session.phase,
    mode: session.mode,
    preset: session.preset,
    status: session.status,
    attemptNumber: session.attemptNumber,
    total: session.questions.length,
    currentIndex: session.currentIndex,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
  };
  if (session.status === 'in_progress') return res.json({ interview: base });

  const answers = await Answer.find({ session: session._id }).lean();
  const byIdx = new Map(answers.map((a) => [a.questionIndex, a]));
  res.json({
    interview: {
      ...base,
      // skills/difficulty/source revealed after the interview; reference answers stay hidden
      // (Module 4 decides how much of them to show as feedback)
      questions: session.questions.map((q) => {
        const a = byIdx.get(q.index);
        return {
          index: q.index, category: q.category, text: q.text, skills: q.skills, skillSource: q.skillSource,
          difficulty: q.difficulty, timeLimitSec: q.timeLimitSec,
          answer: a ? { text: a.text, status: a.status, timeTakenSec: a.timeTakenSec } : null,
        };
      }),
    },
  });
}
