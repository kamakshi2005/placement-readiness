// Scores one answer: 2 independent runs (variant A on one lite model + variant B on ANOTHER lite
// model), a 3rd (variant C) only if they disagree,
// every quote verified against the answer, then aggregated with an uncertainty range.
import crypto from 'crypto';
import { generateJSON, embed, modelInfo } from '../llm.js';
import { modelsForTask } from '../../config/models.js';
import { buildScoringPrompt, scoringSchema } from './rubric.js';
import { findQuote } from './evidence.js';
import { aggregateRuns, coverageFromLabels, computeOverall, needThirdRun } from './aggregate.js';
import { cosine } from '../matcher.js';
import {
  SCORING_PROMPT_VERSION,
  WEIGHTS,
  RUN_VARIANTS,
  MIN_RUNS,
  MAX_RUNS,
  RUN_TEMPERATURE,
  THIRD_RUN_SCORE_GAP,
  UNCERTAIN_RANGE,
} from '../../config/scoring.js';

// Each rubric variant runs on its own task -> its own model (config/models.js), so runs differ in
// model as well as wording. Pacing per model happens inside llm.js.
const TASK_FOR_VARIANT = { A: 'score_a', B: 'score_b', C: 'score_c' };

const clamp04 = (x) => Math.max(0, Math.min(4, Math.round(Number(x) || 0)));

/** Seeded shuffle (same seed -> same order), so a run's key-point order can be reproduced */
function seededShuffle(arr, seedText) {
  let seed = parseInt(crypto.createHash('sha256').update(seedText).digest('hex').slice(0, 8), 16);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One scoring run with one rubric variant. Returns the run, with every quote verified. */
async function scoringRun({ variant, question, reference, answer, seedKey }) {
  // Variant A keeps the original key-point order; B and C shuffle it (seeded per answer + variant)
  const kpOrdered = variant === 'A' ? reference.keyPoints : seededShuffle(reference.keyPoints, `${seedKey}|${variant}`);
  const t = Date.now();
  const { data: raw, meta } = await generateJSON({
    task: TASK_FOR_VARIANT[variant],
    prompt: buildScoringPrompt(variant, { question, reference: { ...reference, keyPoints: kpOrdered }, answer }),
    schema: scoringSchema(variant),
    temperature: RUN_TEMPERATURE,
  });

  const quotes = { returned: 0, verified: 0, fuzzy: 0, dropped: 0 };
  const verify = (q) => {
    quotes.returned++;
    const span = findQuote(answer, q);
    if (!span) {
      quotes.dropped++;
      return null;
    }
    quotes.verified++;
    if (span.matchType === 'fuzzy') quotes.fuzzy++;
    return span;
  };

  const byId = new Map((raw.keyPoints || []).map((k) => [k.id, k]));
  const keyPoints = reference.keyPoints.map(({ id }) => {
    const k = byId.get(id);
    const label = ['covered', 'partial', 'missing'].includes(k?.label) ? k.label : 'missing';
    const evidence = label === 'missing' ? [] : (k.evidence || []).map(verify).filter(Boolean);
    return { id, label, evidence };
  });
  const errors = (raw.errors || [])
    .map((e) => {
      const span = verify(e.quote);
      return span ? { ...span, explanation: String(e.explanation || '').trim() } : null;
    })
    .filter(Boolean);

  const dims = { correctness: clamp04(raw.correctness), depth: clamp04(raw.depth), clarity: clamp04(raw.clarity) };
  const coverage = coverageFromLabels(keyPoints.map((k) => k.label));
  return {
    variant,
    model: meta.model, // model that answered (may be a fallback)
    modelVersion: meta.modelVersion,
    ...(meta.fallbackFrom && { fallbackFrom: meta.fallbackFrom }),
    kpOrder: kpOrdered.map((k) => k.id),
    keyPoints,
    errors,
    ...dims,
    coverage,
    overall: computeOverall({ coverage, ...dims }),
    strengths: (raw.strengths || []).slice(0, 3),
    improvements: (raw.improvements || []).slice(0, 3),
    quotes,
    durationMs: Date.now() - t,
    raw,
  };
}

/**
 * Score an answer text against a question's reference. No database access — used by the app
 * (via evaluateAnswer) and directly by the validation script.
 * @returns everything an AnswerEvaluation needs except ids/version
 */
export async function scoreAnswerText({ question, reference, answer, seedKey }) {
  const args = { question, reference, answer, seedKey };
  // runs 1 and 2 in parallel (A and B)
  const runs = await Promise.all(RUN_VARIANTS.slice(0, MIN_RUNS).map((variant) => scoringRun({ ...args, variant })));
  if (MAX_RUNS > MIN_RUNS && needThirdRun(runs)) {
    try {
      runs.push(await scoringRun({ ...args, variant: RUN_VARIANTS[2] }));
    } catch (e) {
      // keep the two runs; the even-split rule then picks the lower label (conservative)
      console.warn('[scoring] third run failed:', e.message);
    }
  }

  const agg = aggregateRuns(runs, reference.keyPoints, answer);
  const quoteStats = runs.reduce(
    (t, r) => ({
      returned: t.returned + r.quotes.returned,
      verified: t.verified + r.quotes.verified,
      fuzzy: t.fuzzy + r.quotes.fuzzy,
      dropped: t.dropped + r.quotes.dropped,
    }),
    { returned: 0, verified: 0, fuzzy: 0, dropped: 0 }
  );

  // Reported, not part of the score: how close the answer is in meaning to the reference
  let refSimilarity = null;
  try {
    const [a, b] = await embed([answer.slice(0, 6000), reference.answer.slice(0, 6000)]);
    refSimilarity = Number(cosine(a, b).toFixed(4));
  } catch (e) {
    console.warn('[scoring] reference similarity failed:', e.message);
  }

  const { embedModel } = modelInfo();
  return {
    method: 'llm',
    keyPointsUsed: reference.keyPoints,
    runs: runs.map(({ strengths, improvements, errors, keyPoints, ...r }) => ({
      ...r,
      keyPoints: keyPoints.map(({ id, label }) => ({ id, label })),
    })),
    ...agg,
    quoteStats,
    refSimilarity,
    config: {
      runModels: Object.fromEntries(Object.entries(TASK_FOR_VARIANT).map(([v, t]) => [v, modelsForTask(t)[0]])),
      embedModel,
      promptVersion: SCORING_PROMPT_VERSION,
      temperature: RUN_TEMPERATURE,
      weights: WEIGHTS,
      minRuns: MIN_RUNS,
      maxRuns: MAX_RUNS,
      thirdRunScoreGap: THIRD_RUN_SCORE_GAP,
      uncertainRange: UNCERTAIN_RANGE,
    },
  };
}

/** "This job asks for X — your answer didn't show: …" for each question skill with missing points */
export function jdGapsFor(skills, keyPoints) {
  const missing = keyPoints.filter((k) => k.label === 'missing').map((k) => k.text);
  if (!missing.length || !skills?.length) return [];
  return [`This job asks for ${skills.join(' and ')}. Your answer didn't show: ${missing.join('; ')}.`];
}
