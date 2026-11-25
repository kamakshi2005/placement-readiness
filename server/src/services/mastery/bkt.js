// Bayesian Knowledge Tracing for one skill — pure functions (no AI, no database).
//
// State: P(mastered). For every answer (evidence):
//   1. Bayes update, tempered by the evidence weight w (0..1):
//        P' = P·L_m^w / (P·L_m^w + (1 − P)·L_n^w)
//      L_m / L_n = how likely this score is if the skill IS / IS NOT mastered.
//      w = 1 is the normal update, w = 0 changes nothing.
//   2. Between interviews whose results the student viewed: learning,
//        P' = P + (1 − P)·learn       (no learning between questions of ONE interview: no feedback)
//
// Two evidence models:
//   continuous (main)  — L from the Beta score curves (the exact score counts)
//   threshold (baseline) — score ≥ 60 is "correct": L = 1 − slip / guess, else slip / 1 − guess
// ASSUMPTION: answers within one interview are independent evidence given the mastery state.
import { fitCurve, curveDensity } from '../../utils/beta.js';
import { PARAMS, CURVES, RANGE } from '../../config/mastery.js';

const curveCache = new Map();

/** Mastered / not-mastered score curves that match the given guess and slip */
export function curvesFor({ guess, slip }, curves = CURVES) {
  const key = `${guess}|${slip}|${curves.eps}|${curves.cut}`;
  if (!curveCache.has(key)) {
    curveCache.set(key, {
      mastered: fitCurve({ cut: curves.cut, tail: 'below', target: slip, eps: curves.eps }),
      notMastered: fitCurve({ cut: curves.cut, tail: 'above', target: guess, eps: curves.eps }),
    });
  }
  return curveCache.get(key);
}

/** Likelihoods [L_mastered, L_notMastered] of a 0–100 score under each evidence model */
export function likelihoods(score, params, model = 'continuous', curves = CURVES) {
  const s = Math.min(curves.clamp[1], Math.max(curves.clamp[0], score / 100));
  if (model === 'threshold') {
    const correct = score >= curves.cut * 100;
    return correct ? [1 - params.slip, params.guess] : [params.slip, 1 - params.guess];
  }
  const c = curvesFor(params, curves);
  return [curveDensity(s, c.mastered), curveDensity(s, c.notMastered)];
}

/** One tempered Bayes update */
export function bayesUpdate(p, [lm, ln], w) {
  const a = p * lm ** w;
  const b = (1 - p) * ln ** w;
  return a / (a + b);
}

export const learnStep = (p, learn) => p + (1 - p) * learn;

/**
 * Trace one skill through its evidence, in time order.
 * @param prior     starting P(mastered)
 * @param evidence  [{ score: 0–100, weight: 0–1, session, learnBefore }]
 *                  learnBefore = this is the first answer of a new interview AND the student
 *                  viewed the results of an earlier interview -> apply learning first
 * @returns { p, steps: [{ pBefore, pAfter, ... }] }
 */
export function traceSkill(prior, evidence, { params = PARAMS, model = 'continuous', curves = CURVES } = {}) {
  let p = prior;
  const steps = [];
  for (const ev of evidence) {
    if (ev.learnBefore) p = learnStep(p, params.learn);
    const pBefore = p;
    if (ev.weight > 0) p = bayesUpdate(p, likelihoods(ev.score, params, model, curves), ev.weight);
    steps.push({ ...ev, pBefore, pAfter: p });
  }
  return { p, steps };
}

// ---------------- uncertainty range (parameter uncertainty) ----------------

/** Small seeded random generator (mulberry32) so a skill's range is stable between recomputations */
export function seededRandom(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, q) {
  const i = (sorted.length - 1) * (q / 100);
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

/**
 * Re-run the trace with many plausible parameter sets; the middle 80 % of the resulting
 * P(mastered) values is the range shown to the student. Little evidence -> the prior's
 * uncertainty dominates -> wide; much consistent evidence -> all sets agree -> narrow.
 */
export function masteryRange(prior, evidence, { seed = 'x', range = RANGE, curves = CURVES } = {}) {
  const rnd = seededRandom(seed);
  const u = ([lo, hi]) => lo + (hi - lo) * rnd();
  // the uniform part alone puts eps·cut of mastered scores below the cut: slip/guess can't be lower
  const slipRange = [Math.max(range.slip[0], curves.eps * curves.cut + 0.01), range.slip[1]];
  const guessRange = [Math.max(range.guess[0], curves.eps * (1 - curves.cut) + 0.01), range.guess[1]];
  const ps = [];
  for (let i = 0; i < range.draws; i++) {
    const params = { learn: u(range.learn), guess: u(guessRange), slip: u(slipRange), forget: 0 };
    // round guess/slip so the curve cache gets reused across draws (2 decimals is plenty)
    params.guess = Math.round(params.guess * 100) / 100;
    params.slip = Math.round(params.slip * 100) / 100;
    const pr = Math.min(0.98, Math.max(0.02, prior * u(range.priorFactor)));
    ps.push(traceSkill(pr, evidence, { params, curves }).p);
  }
  ps.sort((a, b) => a - b);
  return { low: percentile(ps, range.percentiles[0]), high: percentile(ps, range.percentiles[1]) };
}
