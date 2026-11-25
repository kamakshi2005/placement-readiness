// Phase 2 — Bayesian Knowledge Tracing settings. All values are PROVISIONAL until checked:
// guess/slip against hand-labelled answers ("competent?" column), the mastery threshold and the
// curve shape from the simulation (npm run sim:mastery), learn and priors from real usage data.

// Starting P(mastered) from the Module 2 resume–JD match status
export const PRIORS = { missing: 0.15, partial: 0.35, matched: 0.6, unknown: 0.3 };

export const PARAMS = {
  learn: 0.1, // P(not mastered -> mastered) between interviews whose results were viewed
  guess: 0.2, // P(score ≥ 60 | not mastered)
  slip: 0.1, // P(score < 60 | mastered)
  forget: 0, // classic BKT: no forgetting
};

// Score curves on score/100: mastered = Beta(a, 1) (rises towards 100), not mastered = Beta(1, b)
// (falls from 0); a and b are fitted from slip and guess. Each is mixed with a uniform part of
// weight eps, so one answer can never be near-certain proof.
export const CURVES = {
  cut: 0.6, // the "60" in the guess/slip definitions
  // 15 % (cautious) chosen over 5 % by simulation (eval/mastery/results/sim-2026-11-25.json): Brier
  // ~0.005–0.009 worse when real scores are clean, slightly better when they are messy, +1 answer
  // to reach 95 %, same or lower false mastery. Revisit when real data shows how cleanly scores
  // separate. Floors: slip ≥ eps·cut = 0.09, guess ≥ eps·(1 − cut) = 0.06.
  eps: 0.15,
  clamp: [0.02, 0.98], // scores of 0 / 100 are treated as 2 / 98 (keeps densities finite)
};

// Evidence weights (multiplied together; weight 1 = normal Bayes update, 0 = no update)
export const WEIGHTS = {
  multiSkillShare: 0.5, // each skill of a 2-skill (project) question
  skipped: 0.5, // a skipped answer counts as score 0 at half weight
  nearDuplicate: 0.5, // repeat of a question the student had already seen (results / model answer)
};

// Near-duplicate question detection: questions that share a skill AND have the same normalised
// text or an embedding cosine at or above this cut-off. Calibrated (npm run calibrate:repeats,
// eval/mastery/results/repeats-2026-11-24.json, gemini-embedding-001): reworded repeats 0.895–0.992,
// different questions on the same skill 0.734–0.873 -> cut-off halfway, 0.885. Small sample (28
// questions); the margin is only ~0.02, so re-check when more questions exist.
export const NEAR_DUPLICATE_COSINE = 0.885;

export const MASTERED_AT = 0.95; // provisional; choose from the simulation (85 / 90 / 95 %)
export const STATUS_BANDS = { notYet: 0.4 }; // < 40 % "not yet", up to MASTERED_AT "developing"

// Uncertainty range = spread of P(mastered) over plausible parameter values (parameter
// uncertainty). Each draw samples every parameter uniformly within these factors / ranges.
// Widened after the first simulation (ranges 0.5–1.5 / 0.05–0.2 / 0.1–0.3 covered the true-parameter
// value only ~50 % of the time when reality fell outside them).
// Note: the uniform part puts eps·cut of a MASTERED student's scores below 60 by itself, so slip
// cannot be below eps·cut (and guess not below eps·(1 − cut)); draws below those floors are raised.
export const RANGE = {
  draws: 200,
  percentiles: [10, 90], // middle 80 %
  priorFactor: [0.3, 2], // prior × factor, clipped to 0.02–0.98
  learn: [0.02, 0.2],
  guess: [0.1, 0.35],
  slip: [0.05, 0.2],
};
