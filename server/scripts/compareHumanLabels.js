// Compares your hand labels with the AI scorer (Phase 1 validation, real answers).
// Usage: npm run eval:human -- <answers.csv> <keypoints.csv>
//
// Reports, on answers where the reference AND key points were marked correct:
//   key points    — agreement % and Cohen's kappa (covered / partial / missing)
//   dimensions    — mean absolute difference and Spearman, model vs you
//   overall score — the same 40/30/20/10 formula applied to YOUR labels vs the model's score
// Answers whose reference or key points you marked wrong are reported separately: those are
// question-generation errors, and scoring against a wrong reference can't be "right".
import fs from 'fs';
import { parseCSV } from '../src/utils/csv.js';
import { mean, spearman, cohenKappa } from '../src/utils/stats.js';
import { computeOverall, coverageFromLabels } from '../src/services/scoring/aggregate.js';

const [fa, fk] = process.argv.slice(2);
if (!fa || !fk) {
  console.error('Usage: npm run eval:human -- <answers.csv> <keypoints.csv>');
  process.exit(1);
}
const answers = parseCSV(fs.readFileSync(fa, 'utf8'));
const kps = parseCSV(fs.readFileSync(fk, 'utf8'));

const LABELS = ['covered', 'partial', 'missing'];
const yes = (v) => /^y(es)?$/i.test(v);
const problems = [];

// ---- which answers are usable ----
const kpByEval = new Map();
for (const k of kps) {
  if (!kpByEval.has(k.evaluation_id)) kpByEval.set(k.evaluation_id, []);
  kpByEval.get(k.evaluation_id).push(k);
}
const labelled = answers.filter((a) => ['human_correctness', 'human_depth', 'human_clarity'].every((c) => a[c] !== ''));
const badReference = labelled.filter((a) => /^(no|partly)$/i.test(a.human_reference_correct));
const badKp = labelled.filter((a) => (kpByEval.get(a.evaluation_id) || []).some((k) => k.human_kp_correct && !yes(k.human_kp_correct)));
const usable = labelled.filter((a) => !badReference.includes(a) && !badKp.includes(a));

for (const a of labelled) {
  for (const c of ['human_correctness', 'human_depth', 'human_clarity']) {
    const v = Number(a[c]);
    if (!(Number.isInteger(v) && v >= 0 && v <= 4)) problems.push(`${a.evaluation_id}: ${c} must be 0-4 (got "${a[c]}")`);
  }
  for (const k of kpByEval.get(a.evaluation_id) || []) {
    if (!LABELS.includes(k.human_label)) problems.push(`${a.evaluation_id} ${k.kp_id}: human_label must be covered/partial/missing (got "${k.human_label}")`);
  }
}
if (problems.length) {
  console.error('Fix these first:\n  ' + problems.slice(0, 20).join('\n  ') + (problems.length > 20 ? `\n  … ${problems.length - 20} more` : ''));
  process.exit(1);
}

console.log(`Answers in sheet: ${answers.length} · fully labelled: ${labelled.length}`);
console.log(`Question-generation problems you found: reference wrong/partly wrong ${badReference.length}, a key point wrong ${badKp.length}`);
console.log(`Usable for scorer agreement: ${usable.length}\n`);
if (!usable.length) process.exit(0);

// ---- key points ----
const kpPairs = usable.flatMap((a) => kpByEval.get(a.evaluation_id) || []);
const agree = kpPairs.filter((k) => k.model_label === k.human_label).length;
console.log(`Key points: ${kpPairs.length} labelled, agreement ${Math.round((agree / kpPairs.length) * 100)}%, Cohen's kappa ${cohenKappa(kpPairs.map((k) => k.model_label), kpPairs.map((k) => k.human_label)).toFixed(2)}`);
const confusion = Object.fromEntries(LABELS.map((h) => [h, Object.fromEntries(LABELS.map((m) => [m, kpPairs.filter((k) => k.human_label === h && k.model_label === m).length]))]));
console.log('  confusion (rows = you, columns = model):');
console.log('              ' + LABELS.map((l) => l.padStart(8)).join(''));
for (const h of LABELS) console.log(`    ${h.padEnd(9)} ` + LABELS.map((m) => String(confusion[h][m]).padStart(8)).join(''));

// ---- dimensions ----
console.log('\nDimensions (model = median of runs, 0-4):');
for (const d of ['correctness', 'depth', 'clarity']) {
  const m = usable.map((a) => Number(a[`model_${d}`]));
  const h = usable.map((a) => Number(a[`human_${d}`]));
  console.log(`  ${d.padEnd(12)} mean |model - you| ${mean(m.map((x, i) => Math.abs(x - h[i]))).toFixed(2)}   Spearman ${spearman(m, h).toFixed(2)}`);
}

// ---- overall score ----
const humanScore = (a) =>
  computeOverall({
    coverage: coverageFromLabels((kpByEval.get(a.evaluation_id) || []).map((k) => k.human_label)),
    correctness: Number(a.human_correctness),
    depth: Number(a.human_depth),
    clarity: Number(a.human_clarity),
  });
const ms = usable.map((a) => Number(a.model_score));
const hs = usable.map(humanScore);
const inRange = usable.filter((a, i) => {
  const [lo, hi] = a.model_range.split('-').map(Number);
  return hs[i] >= lo && hs[i] <= hi;
}).length;
console.log(`\nOverall score: mean |model - you| ${mean(ms.map((x, i) => Math.abs(x - hs[i]))).toFixed(1)} points · Spearman ${spearman(ms, hs).toFixed(2)}`);
console.log(`Your score fell inside the model's range: ${inRange}/${usable.length}`);
const flagged = usable.filter((a) => a.model_uncertain === 'yes');
if (flagged.length) {
  const err = (list) => mean(list.map((a) => Math.abs(Number(a.model_score) - humanScore(a))));
  console.log(`Flagged "uncertain": ${flagged.length} — mean error ${err(flagged).toFixed(1)} vs ${err(usable.filter((a) => a.model_uncertain !== 'yes')).toFixed(1)} on unflagged (flags are useful if the first is larger)`);
}
