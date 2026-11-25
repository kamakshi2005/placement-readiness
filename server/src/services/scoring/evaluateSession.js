// Background scoring of a finished interview, plus saving results to the database.
// Runs inside the server process (Phase 6 replaces this with a real job queue). If the server
// restarts mid-way, resumePendingScoring() picks unfinished sessions up again on start-up.
import InterviewSession from '../../models/InterviewSession.js';
import Answer from '../../models/Answer.js';
import AnswerEvaluation from '../../models/AnswerEvaluation.js';
import { normalizeKeyPoints } from '../questionGenerator.js';
import { scoreAnswerText, jdGapsFor } from './scorer.js';
import { modelInfo } from '../llm.js';
import { SCORING_PROMPT_VERSION } from '../../config/scoring.js';
import { modelsForTask, DAILY_RESERVE } from '../../config/models.js';
import { remainingToday, resetInWords } from '../aiQuota.js';
import { llmMode } from '../llmRecorder.js';
import { recomputeMastery } from '../mastery/masteryService.js';

// Expected AI requests per AI-scored answer: run A + run B always, run C for about half
const THIRD_RUN_SHARE = 0.5;

/**
 * Is there enough daily quota to score `n` answers? Checks the scoring models together
 * (a run whose model is used up falls back to the other lite model) plus embeddings.
 * @returns { ok, message }
 */
export async function checkScoringQuota(n) {
  if (!n || llmMode() === 'replay') return { ok: true };
  const need = 2 * n + Math.ceil(n * THIRD_RUN_SHARE);
  const lite = [...new Set(['score_a', 'score_b', 'score_c'].flatMap(modelsForTask))];
  let available = 0;
  for (const m of lite) available += Math.max(0, (await remainingToday(m)) - DAILY_RESERVE);
  const embedLeft = (await remainingToday(modelInfo().embedModel)) - DAILY_RESERVE;
  if (available >= need && embedLeft >= n) return { ok: true };
  return {
    ok: false,
    message: `Not enough free AI quota left today to score ${n} answer(s) (needs about ${need} requests, ${available} left). Scoring will start automatically after the daily reset, in ${resetInWords()}.`,
  };
}

const running = new Set(); // session ids being scored in this process

/** Score ONE answer and save a new AnswerEvaluation version. */
export async function evaluateAnswer(answerDoc, question) {
  const latest = await AnswerEvaluation.findOne({ answer: answerDoc._id }).sort({ version: -1 }).select('version').lean();
  const base = {
    answer: answerDoc._id,
    session: answerDoc.session,
    user: answerDoc.user,
    questionIndex: answerDoc.questionIndex,
    version: (latest?.version || 0) + 1,
    timedOut: answerDoc.status === 'timed_out',
  };

  let result;
  const text = (answerDoc.text || '').trim();
  const autoReason =
    answerDoc.status === 'skipped' ? 'skipped' : answerDoc.status === 'not_reached' ? 'not reached' : !text ? 'empty answer' : null;
  const keyPoints = normalizeKeyPoints(question.reference?.keyPoints);

  if (autoReason) {
    // No AI call: nothing to score
    result = {
      method: 'auto',
      autoReason,
      keyPointsUsed: keyPoints,
      keyPoints: keyPoints.map((k) => ({ ...k, label: 'missing', votes: { covered: 0, partial: 0, missing: 0 }, unresolved: false, evidence: [] })),
      errorSpans: [],
      score: 0,
      scoreMin: 0,
      scoreMax: 0,
      uncertain: false,
      uncertainReasons: [],
      confidence: { value: 1, abSpread: 0, kpDisagreementAB: 0, thirdRun: false }, // no judgement involved
      feedback: { strengths: [], improvements: [] },
      config: { promptVersion: SCORING_PROMPT_VERSION },
    };
  } else {
    result = await scoreAnswerText({
      question: { text: question.text, category: question.category, difficulty: question.difficulty, skills: question.skills },
      reference: { answer: question.reference.answer, keyPoints },
      answer: answerDoc.text,
      seedKey: String(answerDoc._id),
    });
  }
  result.feedback = { ...result.feedback, jdGaps: jdGapsFor(question.skills, result.keyPoints) };

  const evaluation = await AnswerEvaluation.create({ ...base, ...result });
  await Answer.updateOne(
    { _id: answerDoc._id },
    {
      $set: {
        evaluation: evaluation._id,
        score: evaluation.score,
        scoreMin: evaluation.scoreMin,
        scoreMax: evaluation.scoreMax,
        uncertain: evaluation.uncertain,
        scoreConfidence: evaluation.confidence?.value,
      },
    }
  );
  return evaluation;
}

/**
 * Score every answer of a session that has no evaluation yet (or all of them, with rescore=true
 * — that adds new versions). Progress is stored on the session so the client can poll it.
 */
export async function scoreSession(sessionId, { rescore = false } = {}) {
  const id = String(sessionId);
  if (running.has(id)) return;
  running.add(id);
  try {
    const session = await InterviewSession.findById(id).select('+questions.reference');
    if (!session || session.status === 'in_progress') return;

    const answers = await Answer.find({ session: id, ...(rescore ? {} : { evaluation: { $exists: false } }) });
    const already = rescore ? 0 : await Answer.countDocuments({ session: id, evaluation: { $exists: true } });

    // Don't start a job that would run out of quota half-way: wait for the daily reset instead
    const aiAnswers = answers.filter((a) => a.status !== 'skipped' && a.status !== 'not_reached' && (a.text || '').trim()).length;
    const quota = await checkScoringQuota(aiAnswers);
    if (!quota.ok) {
      await InterviewSession.updateOne(
        { _id: id },
        { $set: { 'scoring.status': 'waiting_quota', 'scoring.total': answers.length + already, 'scoring.done': already, 'scoring.error': quota.message } }
      );
      console.log(`[scoring] session ${id} waiting for quota: ${quota.message}`);
      return;
    }

    await InterviewSession.updateOne(
      { _id: id },
      { $set: { 'scoring.status': 'running', 'scoring.total': answers.length + already, 'scoring.done': already, 'scoring.startedAt': new Date(), 'scoring.error': null } }
    );

    // All answers in parallel — llm.js paces the actual AI calls per model
    const failures = [];
    await Promise.all(
      answers.map(async (a) => {
        try {
          await evaluateAnswer(a, session.questions[a.questionIndex]);
          await InterviewSession.updateOne({ _id: id }, { $inc: { 'scoring.done': 1 } });
        } catch (e) {
          failures.push(`Q${a.questionIndex + 1}: ${e.message}`);
        }
      })
    );

    await InterviewSession.updateOne(
      { _id: id },
      {
        $set: {
          'scoring.status': failures.length ? 'failed' : 'done',
          'scoring.finishedAt': new Date(),
          'scoring.error': failures.length ? failures.join(' | ').slice(0, 500) : null,
        },
      }
    );
    if (failures.length) console.warn(`[scoring] session ${id}: ${failures.length} answer(s) failed`);
    // Phase 2: update the student's skill mastery with the new scores (no AI generation calls)
    await recomputeMastery(session.user).catch((e) => console.error('[mastery] recompute failed:', e.message));
  } finally {
    running.delete(id);
  }
}

/** Mark a session for scoring and start it in the background (not awaited by the request). */
export function queueSessionScoring(sessionId) {
  InterviewSession.updateOne({ _id: sessionId }, { $set: { 'scoring.status': 'pending', 'scoring.done': 0 } })
    .then(() => scoreSession(sessionId))
    .catch((e) => console.error('[scoring] could not score session', String(sessionId), e.message));
}

/**
 * Continue scoring that was interrupted (server restart) or is waiting for quota.
 * Called on start-up and every 15 minutes (index.js).
 */
export async function resumePendingScoring() {
  const pending = await InterviewSession.find({
    'scoring.status': { $in: ['pending', 'running', 'waiting_quota'] },
    status: { $ne: 'in_progress' },
  }).select('_id');
  if (pending.length) console.log(`[scoring] resuming ${pending.length} session(s)`);
  for (const s of pending) scoreSession(s._id).catch((e) => console.error('[scoring] resume failed', e.message));
}
