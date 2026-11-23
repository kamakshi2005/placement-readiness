// Which AI model does which job, and each model's free-tier limits.
// Limits are from aistudio.google.com/rate-limit for this key (checked Nov 2026). Google can change
// them at any time — if you see unexpected 429s, check that page and update the numbers here.

// Each task has a list of models: the first is used normally, the rest are fallbacks tried on
// 429 (rate/daily limit) or 503 (overloaded). Override the first one per task with an env var,
// e.g. GEMINI_MODEL_SCORE_A=gemini-3.1-flash-lite.
export const TASK_MODELS = {
  // few, high-value calls -> the strongest (but 20/day) model, with the other flash as fallback
  extraction: ['gemini-3.5-flash', 'gemini-3.8-flash'], // resume / JD skill extraction
  questions: ['gemini-3.5-flash', 'gemini-3.8-flash'], // writing interview questions (+ repair)
  // many small calls -> lite models (500/day each)
  judge: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], // matcher's borderline yes/partial/no
  // scoring runs deliberately use DIFFERENT models, so disagreement also reflects different
  // model biases, not only sampling noise (fallback = the other lite model)
  score_a: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  score_b: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
  score_c: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  eval: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], // validation-script helpers (test answers)
};

export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

// rpm = requests per minute, rpd = requests per day, concurrency = calls in flight at once,
// timeoutMs = give up on ONE request after this long (a hung request once stalled scoring for
// 5 minutes); a timeout is treated like an overload: retry, then fall back to the next model.
// Note: Google serves "gemini-3.5-flash" with Gemini 3.6 Flash; its quota is listed under 3.6.
export const MODEL_LIMITS = {
  'gemini-3.5-flash': { rpm: 5, rpd: 20, concurrency: 1, timeoutMs: 120000 }, // writing 8 questions can take ~45 s
  'gemini-3.8-flash': { rpm: 5, rpd: 20, concurrency: 1, timeoutMs: 120000 },
  'gemini-3.5-flash-lite': { rpm: 15, rpd: 500, concurrency: 3, timeoutMs: 45000 }, // usually 2–4 s
  'gemini-3.1-flash-lite': { rpm: 15, rpd: 500, concurrency: 3, timeoutMs: 45000 },
  'gemini-embedding-001': { rpm: 100, rpd: 1000, concurrency: 5, timeoutMs: 30000 },
  'gemini-embedding-2': { rpm: 100, rpd: 1000, concurrency: 5, timeoutMs: 30000 },
};
const DEFAULT_LIMITS = { rpm: 5, rpd: 20, concurrency: 1, timeoutMs: 120000 }; // unknown model: be careful

export function limitsFor(model) {
  return MODEL_LIMITS[model] || DEFAULT_LIMITS;
}

/** Model list for a task, with an optional env override for the first choice */
export function modelsForTask(task) {
  const list = TASK_MODELS[task];
  if (!list) throw new Error(`Unknown AI task "${task}"`);
  const override = process.env[`GEMINI_MODEL_${task.toUpperCase()}`];
  return override ? [override, ...list.filter((m) => m !== override)] : list;
}

// Free-tier daily quotas reset at midnight Pacific time
export const QUOTA_TIMEZONE = 'America/Los_Angeles';

// Keep this many requests per model in reserve: a job only starts if it fits under rpd - reserve
export const DAILY_RESERVE = 2;
