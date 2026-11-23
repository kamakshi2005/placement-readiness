// Combines 2–3 independent scoring runs into one result with an honest uncertainty range.
// Pure functions (no AI, no database) — unit-tested in test/aggregate.test.js.
import { WEIGHTS, KP_CREDIT, THIRD_RUN_SCORE_GAP, UNCERTAIN_RANGE } from '../../config/scoring.js';
import { overlaps, mergeSpans } from './evidence.js';

const ORDINAL = { missing: 0, partial: 1, covered: 2 };
const LABELS = ['missing', 'partial', 'covered'];

export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Coverage 0–1 from key-point labels: covered = 1, partial = ½, missing = 0 */
export function coverageFromLabels(labels) {
  return labels.length ? labels.reduce((t, l) => t + (KP_CREDIT[l] ?? 0), 0) / labels.length : 0;
}

/** Overall 0–100 = weighted sum of coverage (0–1) and the three 0–4 dimensions */
export function computeOverall({ coverage, correctness, depth, clarity }) {
  return Math.round(
    100 * (WEIGHTS.coverage * coverage + WEIGHTS.correctness * (correctness / 4) + WEIGHTS.depth * (depth / 4) + WEIGHTS.clarity * (clarity / 4))
  );
}

/** After 2 runs: is a 3rd run needed? (scores far apart, or any key-point label differs) */
export function needThirdRun([r1, r2]) {
  if (Math.abs(r1.overall - r2.overall) > THIRD_RUN_SCORE_GAP) return true;
  const l2 = new Map(r2.keyPoints.map((k) => [k.id, k.label]));
  return r1.keyPoints.some((k) => l2.get(k.id) !== k.label);
}

/**
 * @param runs  [{ keyPoints:[{id,label,evidence:[span]}], errors:[{...span, explanation}],
 *                correctness, depth, clarity, overall, strengths, improvements }]
 * @param keyPoints  [{id, text}] — the question's key points
 * @param answer     the student's answer text (for span texts)
 */
export function aggregateRuns(runs, keyPoints, answer) {
  const n = runs.length;
  const majority = Math.floor(n / 2) + 1; // 2 of 2, 2 of 3

  // ---- key points: median label (ordinal), "unresolved" if no label has a majority ----
  const kps = keyPoints.map(({ id, text }) => {
    const perRun = runs.map((r) => r.keyPoints.find((k) => k.id === id) || { id, label: 'missing', evidence: [] });
    const votes = { covered: 0, partial: 0, missing: 0 };
    perRun.forEach((k) => votes[k.label]++);
    // median of ordinal votes; for an even split (only if run 3 failed) take the LOWER one
    const ords = perRun.map((k) => ORDINAL[k.label]).sort((a, b) => a - b);
    const label = LABELS[ords[Math.floor((ords.length - 1) / 2)]];
    const unresolved = !Object.values(votes).some((c) => c >= majority);
    // evidence: quotes from the runs that agree with the final label
    const evidence = label === 'missing' ? [] : mergeSpans(perRun.filter((k) => k.label === label).flatMap((k) => k.evidence), answer);
    return { id, text, label, votes, unresolved, evidence };
  });

  // ---- errors: group overlapping quotes across runs; accepted if a majority of runs flagged them ----
  const clusters = [];
  runs.forEach((r, runIdx) => {
    for (const e of r.errors) {
      const c = clusters.find((cl) => cl.spans.some((s) => overlaps(s, e)));
      if (c) {
        c.spans.push(e);
        c.runs.add(runIdx);
      } else {
        clusters.push({ spans: [e], runs: new Set([runIdx]), explanation: e.explanation });
      }
    }
  });
  const errorSpans = clusters.map((c) => {
    const [span] = mergeSpans(c.spans, answer);
    return { ...span, explanation: c.explanation, votes: c.runs.size, accepted: c.runs.size >= majority };
  });

  // ---- dimensions: median across runs, with min/max ----
  const dim = (key) => {
    const v = runs.map((r) => r[key]);
    return { value: median(v), min: Math.min(...v), max: Math.max(...v) };
  };
  const coverageRuns = runs.map((r) => r.coverage);
  const dimensions = {
    coverage: { value: coverageFromLabels(kps.map((k) => k.label)), min: Math.min(...coverageRuns), max: Math.max(...coverageRuns) },
    correctness: dim('correctness'),
    depth: dim('depth'),
    clarity: dim('clarity'),
  };

  // The score comes from the aggregated components (so the parts add up), and the range
  // shows how far the individual runs spread. The range always includes the score itself.
  const score = computeOverall({
    coverage: dimensions.coverage.value,
    correctness: dimensions.correctness.value,
    depth: dimensions.depth.value,
    clarity: dimensions.clarity.value,
  });
  const overalls = runs.map((r) => r.overall);
  const scoreMin = Math.min(score, ...overalls);
  const scoreMax = Math.max(score, ...overalls);

  const uncertainReasons = [];
  if (scoreMax - scoreMin > UNCERTAIN_RANGE) uncertainReasons.push(`Scoring runs disagreed: scores ranged ${scoreMin}–${scoreMax}.`);
  const split = kps.filter((k) => k.unresolved);
  if (split.length) uncertainReasons.push(`Examiners disagreed on ${split.length === 1 ? 'a key point' : `${split.length} key points`}: ${split.map((k) => `"${k.text}"`).join('; ')}.`);

  // Feedback text from the most representative run (overall closest to the final score)
  const rep = runs.reduce((best, r) => (Math.abs(r.overall - score) < Math.abs(best.overall - score) ? r : best), runs[0]);

  return {
    keyPoints: kps,
    errorSpans,
    dimensions,
    score,
    scoreMin,
    scoreMax,
    uncertain: uncertainReasons.length > 0,
    uncertainReasons,
    feedback: { strengths: rep.strengths || [], improvements: rep.improvements || [] },
  };
}
