// Evaluates the skill matcher against your manual labels and chooses thresholds from data.
// Usage:
//   npm run eval:matcher                                  (uses GEMINI_EMBED_MODEL from .env)
//   npm run eval:matcher -- --embed-model gemini-embedding-2
//   npm run eval:matcher -- --metric lenient
//
// Method:
//   1. For every pair, compute candidates (exact/alias match or closest resume skill + cosine).
//   2. Ask the LLM judge about EVERY non-exact candidate once (cached), so any threshold
//      band can be simulated without new API calls.
//   3. Try all (low, high) threshold combinations on the TUNE pairs; pick the best F1.
//   4. Report that single choice on the HOLDOUT pairs (never used for choosing).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { findCandidates, classify } from '../src/services/matcher.js';
import { cachedEmbed } from '../src/services/aiCache.js';
import { judgeBorderline, PROMPT_VERSION } from '../src/services/skills.js';
import { canonicalSkill } from '../src/services/skillNames.js';
import { modelInfo } from '../src/services/llm.js';

// ---------- options ----------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (opt('embed-model')) process.env.GEMINI_EMBED_MODEL = opt('embed-model');
const METRIC = opt('metric', 'strict'); // strict | lenient
if (!['strict', 'lenient'].includes(METRIC)) throw new Error('--metric must be strict or lenient');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval');
const LABELS = ['present', 'partial', 'absent'];

// ---------- load + validate pairs ----------
const files = fs.readdirSync(path.join(root, 'pairs')).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const pairs = files.map((f) => JSON.parse(fs.readFileSync(path.join(root, 'pairs', f), 'utf8')));
const problems = [];
for (const p of pairs) {
  if (!['tune', 'holdout'].includes(p.split)) problems.push(`${p.id}: split must be "tune" or "holdout"`);
  const seen = new Set();
  for (const s of p.jdSkills) {
    if (!LABELS.includes(s.label)) problems.push(`${p.id}: "${s.name}" has label "${s.label}"`);
    const c = canonicalSkill(s.name);
    if (seen.has(c)) problems.push(`${p.id}: "${s.name}" is a duplicate after normalization`);
    seen.add(c);
  }
}
if (!pairs.length) problems.push('No pair files found in eval/pairs (files starting with "_" are ignored).');
if (problems.length) {
  console.error('Fix these first:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const tune = pairs.filter((p) => p.split === 'tune');
const holdout = pairs.filter((p) => p.split === 'holdout');

await mongoose.connect(process.env.MONGO_URI);
const { genModel, embedModel, embedDims } = modelInfo();
console.log(`Pairs: ${tune.length} tune, ${holdout.length} holdout | ${genModel} | ${embedModel} (${embedDims}d) | prompt ${PROMPT_VERSION} | metric: ${METRIC}\n`);

// ---------- 1 + 2: candidates and judge verdicts (threshold-independent) ----------
for (const p of pairs) {
  p.candidates = await findCandidates({ jdSkills: p.jdSkills, resumeSkills: p.resumeSkills, embed: cachedEmbed });
  const labelOf = new Map(p.jdSkills.map((s) => [canonicalSkill(s.name), s.label]));
  const nonExact = p.candidates.filter((c) => !c.exact && c.resumeSkill);
  const verdicts = nonExact.length
    ? await judgeBorderline(nonExact.map((c) => ({ jdSkill: c.canonical, resumeSkill: canonicalSkill(c.resumeSkill) })))
    : [];
  nonExact.forEach((c, i) => (c.verdict = verdicts[i].verdict));
  p.candidates.forEach((c) => (c.label = labelOf.get(c.canonical)));
}

// ---------- 3: simulate a threshold pair ----------
const JUDGE_STATUS = { yes: 'matched', partial: 'partial', no: 'missing' };

function evaluate(set, high, low) {
  const m = { tp: 0, fp: 0, fn: 0, ltp: 0, lfp: 0, lfn: 0, correct3: 0, n: 0, judged: 0 };
  for (const p of set) {
    for (const r of classify(p.candidates, { high, low })) {
      let status = r.status;
      if (status === 'borderline') {
        m.judged++;
        status = JUDGE_STATUS[r.verdict] || 'missing';
      }
      const gold = r.label;
      // strict: only "present" counts as having the skill, only "matched" counts as predicted
      const gS = gold === 'present', pS = status === 'matched';
      // lenient: partial counts as having it, on both sides
      const gL = gold !== 'absent', pL = status !== 'missing';
      m.tp += gS && pS; m.fp += !gS && pS; m.fn += gS && !pS;
      m.ltp += gL && pL; m.lfp += !gL && pL; m.lfn += gL && !pL;
      m.correct3 += { matched: 'present', partial: 'partial', missing: 'absent' }[status] === gold;
      m.n++;
    }
  }
  const prf = (tp, fp, fn) => {
    const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
    return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
  };
  return { high, low, strict: prf(m.tp, m.fp, m.fn), lenient: prf(m.ltp, m.lfp, m.lfn), acc3: m.n ? m.correct3 / m.n : 0, judged: m.judged, n: m.n };
}

// Grid: 0.40 … 1.01 in steps of 0.01. high = 1.01 means "embeddings never auto-match";
// low = high means "no LLM judge at all" (embeddings only).
const grid = [];
for (let v = 40; v <= 101; v++) grid.push(v / 100);
const sweep = [];
for (const high of grid) for (const low of grid) if (low <= high) sweep.push(evaluate(tune, high, low));

const score = (r) => r[METRIC].f1;
// Best F1; ties -> higher 3-class accuracy (F1 alone ignores whether "partial" is right),
// then fewer judge calls (cheaper), then narrower band
const EPS = 1e-9;
sweep.sort(
  (a, b) =>
    (Math.abs(score(b) - score(a)) > EPS ? score(b) - score(a) : 0) ||
    (Math.abs(b.acc3 - a.acc3) > EPS ? b.acc3 - a.acc3 : 0) ||
    a.judged - b.judged ||
    b.low - a.low
);
const best = sweep[0];

const fmt = (r) =>
  `high ${r.high.toFixed(2)} low ${r.low.toFixed(2)} | strict P ${r.strict.p.toFixed(2)} R ${r.strict.r.toFixed(2)} F1 ${r.strict.f1.toFixed(3)}` +
  ` | lenient F1 ${r.lenient.f1.toFixed(3)} | 3-class acc ${r.acc3.toFixed(2)} | judge calls ${r.judged}/${r.n}`;

console.log('Top 10 threshold pairs on TUNE:');
sweep.slice(0, 10).forEach((r) => console.log('  ' + fmt(r)));

// ---------- 4: compare the three variants on the same pairs ----------
// A. exact/alias only:  no embeddings, no LLM. Anything not matched by name is "missing".
//    (= thresholds above 1, so no similarity ever reaches them)
// B. embeddings only:   one threshold (low = high, so nothing is borderline), best on TUNE.
// C. hybrid:            rules + embeddings + LLM judge, the chosen (high, low) above.
// Thresholds for B and C are chosen on TUNE only; HOLDOUT is just measured.
const embOnly = sweep.filter((r) => r.low === r.high)[0];
const variants = [
  { name: 'A. exact/alias only', high: 1.01, low: 1.01, note: 'no threshold' },
  { name: 'B. embeddings only', high: embOnly.high, low: embOnly.low, note: `threshold ${embOnly.high.toFixed(2)}` },
  { name: 'C. hybrid (+LLM judge)', high: best.high, low: best.low, note: `high ${best.high.toFixed(2)} / low ${best.low.toFixed(2)}` },
];
if (embOnly.high > 1) {
  console.log('\nNote: the best "embeddings only" threshold is above 1, i.e. embeddings never helped on TUNE — B equals A.');
}

const row = (v, set) => {
  const r = evaluate(set, v.high, v.low);
  const f = (x) => x.toFixed(2).padStart(5);
  return (
    `  ${v.name.padEnd(24)} ${v.note.padEnd(20)} | strict P ${f(r.strict.p)} R ${f(r.strict.r)} F1 ${f(r.strict.f1)}` +
    ` | lenient P ${f(r.lenient.p)} R ${f(r.lenient.r)} F1 ${f(r.lenient.f1)} | acc3 ${f(r.acc3)} | judge ${r.judged}/${r.n}`
  );
};
console.log('\nVariant comparison — TUNE (thresholds chosen here):');
variants.forEach((v) => console.log(row(v, tune)));
if (holdout.length) {
  console.log('Variant comparison — HOLDOUT (not used for choosing):');
  variants.forEach((v) => console.log(row(v, holdout)));
} else {
  console.log('No holdout pairs yet — the numbers above are optimistic (chosen and measured on the same data).');
}

console.log(`\nCHOSEN (hybrid): high ${best.high.toFixed(2)}, low ${best.low.toFixed(2)}`);
console.log(`To use: set MATCH_HIGH=${best.high.toFixed(2)} and MATCH_LOW=${best.low.toFixed(2)} in server/.env`);

// ---------- save for the report ----------
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const outDir = path.join(root, 'results');
fs.mkdirSync(outDir, { recursive: true });
const csv = ['high,low,strict_p,strict_r,strict_f1,lenient_p,lenient_r,lenient_f1,acc3,judge_calls,n'];
for (const r of sweep) {
  csv.push([r.high, r.low, r.strict.p, r.strict.r, r.strict.f1, r.lenient.p, r.lenient.r, r.lenient.f1, r.acc3, r.judged, r.n]
    .map((x) => (typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(4) : x)).join(','));
}
const base = `sweep-${embedModel}-${stamp}`;
fs.writeFileSync(path.join(outDir, `${base}.csv`), csv.join('\n') + '\n');
fs.writeFileSync(
  path.join(outDir, `${base}.json`),
  JSON.stringify(
    {
      genModel, embedModel, embedDims, promptVersion: PROMPT_VERSION, metric: METRIC,
      pairs: { tune: tune.map((p) => p.id), holdout: holdout.map((p) => p.id) },
      variants: variants.map((v) => ({
        ...v,
        tune: evaluate(tune, v.high, v.low),
        holdout: holdout.length ? evaluate(holdout, v.high, v.low) : null,
      })),
    },
    null,
    2
  )
);
// Variant table as CSV too, ready for a report table
const vcsv = ['variant,split,thresholds,strict_p,strict_r,strict_f1,lenient_p,lenient_r,lenient_f1,acc3,judge_calls,n'];
for (const v of variants) {
  for (const [split, set] of [['tune', tune], ['holdout', holdout]]) {
    if (!set.length) continue;
    const r = evaluate(set, v.high, v.low);
    vcsv.push([v.name, split, v.note, r.strict.p, r.strict.r, r.strict.f1, r.lenient.p, r.lenient.r, r.lenient.f1, r.acc3, r.judged, r.n]
      .map((x) => (typeof x === 'string' ? `"${x}"` : Number.isInteger(x) ? x : x.toFixed(4))).join(','));
  }
}
fs.writeFileSync(path.join(outDir, `variants-${embedModel}-${stamp}.csv`), vcsv.join('\n') + '\n');
console.log(`Saved eval/results/${base}.csv, ${base}.json and variants-${embedModel}-${stamp}.csv`);

await mongoose.disconnect();
