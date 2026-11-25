// Calibrates the near-duplicate question cut-off (Phase 2) from labelled question groups.
// Usage: npm run calibrate:repeats            (replays the recorded embeddings)
//        npm run calibrate:repeats -- --record (one live embedding request, saved as a fixture)
//
// Pairs inside a group = the SAME question reworded (positives). Pairs of different groups on the
// SAME skill = hard negatives; different skills = easy negatives. Prints the cosine distributions
// and the cut-off with the best F1 on "same question" — written to NEAR_DUPLICATE_COSINE by hand.
import 'dotenv/config';
import { defaultScriptMode } from '../src/services/llmRecorder.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embed } from '../src/services/llm.js';
import { cosine } from '../src/services/matcher.js';
import { prf } from '../src/utils/stats.js';

defaultScriptMode();
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'mastery');
process.env.LLM_FIXTURES_DIR ??= path.join(dir, 'fixtures');

const { groups } = JSON.parse(fs.readFileSync(path.join(dir, 'repeat-pairs.json'), 'utf8'));
const items = groups.flatMap((g) => g.texts.map((text) => ({ text, group: g.id, skill: g.skill })));
const vectors = await embed(items.map((i) => i.text));

const pairs = [];
for (let i = 0; i < items.length; i++) {
  for (let j = i + 1; j < items.length; j++) {
    const kind = items[i].group === items[j].group ? 'same' : items[i].skill === items[j].skill ? 'sameSkill' : 'otherSkill';
    pairs.push({ kind, cos: cosine(vectors[i], vectors[j]), a: items[i].text, b: items[j].text });
  }
}

const stats = (kind) => {
  const v = pairs.filter((p) => p.kind === kind).map((p) => p.cos).sort((a, b) => a - b);
  return v.length ? { n: v.length, min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : { n: 0 };
};
const fmt = (s) => (s.n ? `n=${String(s.n).padStart(3)}  min ${s.min.toFixed(3)}  median ${s.median.toFixed(3)}  max ${s.max.toFixed(3)}` : 'none');
console.log(`${items.length} questions in ${groups.length} groups, ${pairs.length} pairs`);
console.log(`  same question (reworded):        ${fmt(stats('same'))}`);
console.log(`  different question, same skill: ${fmt(stats('sameSkill'))}`);
console.log(`  different skill:                 ${fmt(stats('otherSkill'))}`);

// best cut-off: maximise F1 for "same question" over all observed values
let best = null;
for (const c of [...new Set(pairs.map((p) => Math.round(p.cos * 1000) / 1000))].sort()) {
  let tp = 0, fp = 0, fn = 0;
  for (const p of pairs) {
    const pred = p.cos >= c;
    tp += pred && p.kind === 'same';
    fp += pred && p.kind !== 'same';
    fn += !pred && p.kind === 'same';
  }
  const r = { cut: c, ...prf(tp, fp, fn), tp, fp, fn };
  if (!best || r.f1 > best.f1 || (r.f1 === best.f1 && r.cut > best.cut)) best = r;
}
console.log(`\nBest cut-off: cosine ≥ ${best.cut.toFixed(3)}  ->  precision ${best.precision.toFixed(2)}, recall ${best.recall.toFixed(2)}, F1 ${best.f1.toFixed(2)} (tp ${best.tp}, fp ${best.fp}, fn ${best.fn})`);

const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label}:`);
  for (const p of list.slice(0, 5)) console.log(`  ${p.cos.toFixed(3)}  "${p.a.slice(0, 60)}…"  ~  "${p.b.slice(0, 60)}…"`);
};
show('Mistakes at this cut-off: different questions counted as repeats', pairs.filter((p) => p.cos >= best.cut && p.kind !== 'same').sort((a, b) => b.cos - a.cos));
show('Mistakes at this cut-off: repeats missed', pairs.filter((p) => p.cos < best.cut && p.kind === 'same').sort((a, b) => a.cos - b.cos));

fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
const out = path.join(dir, 'results', `repeats-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify({ stats: { same: stats('same'), sameSkill: stats('sameSkill'), otherSkill: stats('otherSkill') }, best, pairs }, null, 2));
console.log(`\nSaved ${path.relative(process.cwd(), out)}`);
