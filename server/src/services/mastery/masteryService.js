// Computes and stores every skill's mastery for one student (Phase 2).
// No generation calls: only embeddings for the near-duplicate check (cached in LlmCache).
import Analysis from '../../models/Analysis.js';
import InterviewSession from '../../models/InterviewSession.js';
import Answer from '../../models/Answer.js';
import SkillMastery from '../../models/SkillMastery.js';
import { cachedEmbed } from '../aiCache.js';
import { cosine } from '../matcher.js';
import { normalizeText } from '../../utils/normalizeText.js';
import { buildEvidence, priorFor } from './evidence.js';
import { traceSkill, masteryRange } from './bkt.js';
import { PARAMS, CURVES, WEIGHTS, PRIORS, MASTERED_AT, STATUS_BANDS, NEAR_DUPLICATE_COSINE, RANGE } from '../../config/mastery.js';

export function statusFor(p) {
  if (p >= MASTERED_AT) return 'mastered';
  return p < STATUS_BANDS.notYet ? 'not_yet' : 'developing';
}

/** Near-duplicate test over all question texts: same normalised text, or embedding cosine ≥ cut-off */
async function duplicateChecker(texts) {
  const unique = [...new Set(texts)];
  let vec = new Map();
  if (unique.length > 1) {
    try {
      const vectors = await cachedEmbed(unique);
      vec = new Map(unique.map((t, i) => [t, vectors[i]]));
    } catch (e) {
      // embeddings unavailable (quota / offline): fall back to exact-text repeats only
      console.warn('[mastery] near-duplicate embeddings unavailable:', e.message);
    }
  }
  const norm = (t) => normalizeText(t).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
  return (a, b) => norm(a) === norm(b) || (vec.has(a) && vec.has(b) && cosine(vec.get(a), vec.get(b)) >= NEAR_DUPLICATE_COSINE);
}

/** Recompute all skills of one student from scratch and store the snapshots. */
export async function recomputeMastery(userId) {
  const [sessions, answers, analyses] = await Promise.all([
    InterviewSession.find({ user: userId, status: { $ne: 'in_progress' } }).select('createdAt resultsViewedAt questions.index questions.category questions.skills questions.text').lean(),
    Answer.find({ user: userId, evaluation: { $exists: true } }).lean(),
    Analysis.find({ user: userId }).select('createdAt results.jdSkill results.canonical results.status').lean(),
  ]);

  const isNearDuplicate = await duplicateChecker(sessions.flatMap((s) => s.questions.map((q) => q.text)));
  const bySkill = buildEvidence({ sessions, answers, isNearDuplicate });

  const docs = [];
  for (const [skill, { name, evidence }] of bySkill) {
    const { prior, source, name: jdName } = priorFor(skill, analyses);
    const cont = traceSkill(prior, evidence);
    const thr = traceSkill(prior, evidence, { model: 'threshold' });
    const range = masteryRange(prior, evidence, { seed: `${userId}|${skill}` });
    docs.push({
      user: userId,
      skill,
      name: jdName || name, // the JD's wording if the skill came from an analysis
      prior,
      priorSource: source,
      p: cont.p,
      range,
      pThreshold: thr.p,
      status: statusFor(cont.p),
      answers: evidence.length,
      uncertainAnswers: evidence.filter((e) => e.weightParts.confidence < 0.9).length,
      evidence: cont.steps,
      params: { PARAMS, CURVES, WEIGHTS, PRIORS, MASTERED_AT, NEAR_DUPLICATE_COSINE, RANGE: { draws: RANGE.draws, percentiles: RANGE.percentiles } },
    });
  }

  // replace this student's snapshots (skills no longer present are removed)
  await SkillMastery.deleteMany({ user: userId, skill: { $nin: docs.map((d) => d.skill) } });
  if (docs.length) {
    await SkillMastery.bulkWrite(docs.map((d) => ({ replaceOne: { filter: { user: userId, skill: d.skill }, replacement: d, upsert: true } })));
  }
  return docs;
}
