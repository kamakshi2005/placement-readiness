// Interview settings in one place, so they are easy to explain and change.

// How many questions of each category. `study` is the shorter preset for the evaluation study.
export const PRESETS = {
  standard: { technical: 5, project: 2, hr: 1 },
  study: { technical: 4, project: 1, hr: 1 },
};

// Seconds allowed per question, by category
export const TIME_LIMITS = { technical: 180, project: 180, hr: 120 };

// Extra seconds the server accepts after the timer ends (network delay, slow auto-submit)
export const GRACE_SEC = 10;

// Gap mode: share of technical questions spent on skill GAPS (missing/partial skills),
// rounded up. 5 technical -> 3 gap + 2 matched; 4 technical -> 3 gap + 1 matched.
export const GAP_SHARE = 0.6;

// Difficulty is decided in code (not by the AI), from where the skill came from.
// A retest of a skill later uses the same difficulty as its baseline question.
export const DIFFICULTY_BY_SOURCE = {
  missing: 'easy', // not on the resume: ask fundamentals, not deep detail
  partial: 'medium', // a related skill is on the resume: build on it
  matched: 'medium', // on the resume: check the claim
  general: 'medium', // general mode: any JD skill
  resume: 'medium', // project questions
  hr: 'medium',
};

export const MAX_ANSWER_CHARS = 5000;
