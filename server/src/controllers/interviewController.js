import mongoose from 'mongoose';
import Analysis from '../models/Analysis.js';
import InterviewSession from '../models/InterviewSession.js';
import Answer from '../models/Answer.js';
import { PRESETS, TIME_LIMITS, GRACE_SEC, GAP_SHARE, MAX_ANSWER_CHARS } from '../config/interview.js';
import { buildPlan } from '../services/interviewPlanner.js';
import { generateQuestions, QUESTION_PROMPT_VERSION, QUESTION_TEMPERATURE } from '../services/questionGenerator.js';
import { modelInfo } from '../services/llm.js';

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
  await InterviewSession.updateOne({ _id: session._id, currentIndex: idx, status: 'in_progress' }, update);
  session.currentIndex = idx + 1;
  if (last) {
    session.status = 'completed';
    session.completedAt = now;
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

  const written = await generateQuestions({ plan, analysis, previousQuestions });

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
        genModel: modelInfo().genModel,
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
  await InterviewSession.updateOne({ _id: session._id, status: 'in_progress' }, { $set: { status: 'abandoned', completedAt: new Date() } });
  res.json({ status: 'abandoned' });
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
