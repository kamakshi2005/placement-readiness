// Builds the question PLAN for an interview: which category, which JD skills, why those
// skills, what difficulty and how much time — decided in code, before the LLM writes any text.
// This is where "the JD skill gap drives the questions" happens, and it is fully explainable.
import { PRESETS, TIME_LIMITS, GAP_SHARE, DIFFICULTY_BY_SOURCE } from '../config/interview.js';

const importanceRank = (r) => (r.importance === 'required' ? 0 : 1);

/** Fisher–Yates shuffle with an injectable random function (tests can pass a fixed one) */
function shuffle(arr, random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick the JD skills for the technical questions.
 * gap mode:     ceil(GAP_SHARE * n) slots from gaps, in priority order
 *               missing-required > partial-required > missing-nice > partial-nice;
 *               the rest from matched skills (required first), to check resume claims.
 *               If one side runs out, the other side fills the slots.
 * general mode: n JD skills picked at random, ignoring gaps (study Group A practice).
 */
export function pickTechnicalSkills(results, n, mode, random = Math.random) {
  if (mode === 'general') {
    return shuffle(results, random)
      .slice(0, n)
      .map((r) => ({ result: r, source: 'general' }));
  }

  const statusRank = { missing: 0, partial: 1 };
  const gaps = results
    .filter((r) => r.status !== 'matched')
    .sort((a, b) => importanceRank(a) - importanceRank(b) || statusRank[a.status] - statusRank[b.status]);
  const matched = results.filter((r) => r.status === 'matched').sort((a, b) => importanceRank(a) - importanceRank(b));

  const wantGaps = Math.min(Math.ceil(n * GAP_SHARE), gaps.length);
  const wantMatched = Math.min(n - wantGaps, matched.length);
  const extraGaps = Math.min(n - wantGaps - wantMatched, gaps.length - wantGaps); // matched ran out

  return [
    ...gaps.slice(0, wantGaps + extraGaps).map((r) => ({ result: r, source: r.status })), // 'missing' | 'partial'
    ...matched.slice(0, wantMatched).map((r) => ({ result: r, source: 'matched' })),
  ];
}

/**
 * @param analysis  an Analysis document (results, resumeSkills)
 * @param mode      'gap' | 'general'
 * @param preset    key of PRESETS
 * @returns plan: [{ index, category, skills, canonicalSkills, skillSource, difficulty, timeLimitSec }]
 */
export function buildPlan({ analysis, mode, preset, random = Math.random }) {
  const counts = PRESETS[preset];
  if (!counts) throw Object.assign(new Error(`Unknown preset "${preset}"`), { status: 400 });

  const results = analysis.results || [];
  if (!results.length) {
    throw Object.assign(new Error('This analysis found no JD skills, so there is nothing to interview on.'), { status: 400 });
  }

  const plan = [];
  const add = (category, picked, source) =>
    plan.push({
      index: plan.length,
      category,
      skills: picked.map((r) => r.jdSkill),
      canonicalSkills: picked.map((r) => r.canonical),
      skillSource: source,
      difficulty: DIFFICULTY_BY_SOURCE[source],
      timeLimitSec: TIME_LIMITS[category],
    });

  // Technical: one JD skill per question. If the JD has fewer skills than slots, there are
  // simply fewer technical questions (no repeats).
  for (const { result, source } of pickTechnicalSkills(results, counts.technical, mode, random)) {
    add('technical', [result], source);
  }

  // Project: about the student's own projects, linked to up to 2 JD skills the resume shows
  // (matched first; if nothing matched, the most important JD skills).
  const projectSkills = [
    ...results.filter((r) => r.status === 'matched'),
    ...results.filter((r) => r.status !== 'matched'),
  ].sort((a, b) => (a.status === 'matched' ? 0 : 1) - (b.status === 'matched' ? 0 : 1) || importanceRank(a) - importanceRank(b));
  for (let i = 0; i < counts.project; i++) {
    // different skill pair per project question where possible
    const picked = projectSkills.slice(i * 2, i * 2 + 2);
    add('project', picked.length ? picked : projectSkills.slice(0, 2), 'resume');
  }

  // HR: no technical skill tag
  for (let i = 0; i < counts.hr; i++) add('hr', [], 'hr');

  return { plan, counts };
}
