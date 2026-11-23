// Scoring settings in one place (Phase 1 — confidence-aware, evidence-based scoring).

// s2: the scoring instruction is repeated AFTER the candidate's answer, and answers containing
// text addressed to the examiner are flagged uncertain (scoring/manipulation.js)
export const SCORING_PROMPT_VERSION = 's2';

// Rubric weights for the overall 0–100 score. Coverage is computed in code from key-point labels.
export const WEIGHTS = { coverage: 0.4, correctness: 0.3, depth: 0.2, clarity: 0.1 };

// Credit per key-point label when computing coverage
export const KP_CREDIT = { covered: 1, partial: 0.5, missing: 0 };

// Independent scoring runs. Each run uses a DIFFERENT rubric wording (A, B, C) and runs B/C
// shuffle the key-point order, so disagreement reflects real ambiguity, not just sampling noise.
export const RUN_VARIANTS = ['A', 'B', 'C'];
export const MIN_RUNS = 2;
export const MAX_RUNS = 3;
export const RUN_TEMPERATURE = 0.5;

// Run 3 happens only if runs 1 and 2 disagree:
//   overall scores differ by more than this many points, or any key-point label differs
export const THIRD_RUN_SCORE_GAP = 10;

// Final "uncertain" flag (provisional — checked by npm run eval:scorer):
//   range of the runs' overall scores above this, or a key point with no majority label
export const UNCERTAIN_RANGE = 15;

// Fuzzy quote matching: a quote that is not found literally may match a window of the answer
// whose words overlap at least this much (handles small paraphrases / punctuation changes)
export const FUZZY_MIN_OVERLAP = 0.8;
export const FUZZY_MIN_WORDS = 3;

// Concurrency and requests-per-minute are handled per model in llm.js (config/models.js).
