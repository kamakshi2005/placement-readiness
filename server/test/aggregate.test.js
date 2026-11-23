import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRuns, computeOverall, coverageFromLabels, needThirdRun, median } from '../src/services/scoring/aggregate.js';

const KPS = [
  { id: 'k1', text: 'shares the host kernel' },
  { id: 'k2', text: 'starts faster' },
  { id: 'k3', text: 'portable across environments' },
];
const ANSWER = 'Containers share the host kernel. They start faster. VMs are the same as containers.';

// helper: build a run like the scorer does
function run(labels, dims, { errors = [], evidence = {} } = {}) {
  const keyPoints = KPS.map((k, i) => ({ id: k.id, label: labels[i], evidence: evidence[k.id] || [] }));
  const coverage = coverageFromLabels(labels);
  return { keyPoints, errors, ...dims, coverage, overall: computeOverall({ coverage, ...dims }), strengths: ['s'], improvements: ['i'] };
}

test('median and coverage', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 4]), 2.5);
  assert.equal(coverageFromLabels(['covered', 'partial', 'missing']), 0.5);
});

test('computeOverall uses the 40/30/20/10 weights', () => {
  assert.equal(computeOverall({ coverage: 1, correctness: 4, depth: 4, clarity: 4 }), 100);
  assert.equal(computeOverall({ coverage: 0.5, correctness: 2, depth: 2, clarity: 2 }), 50);
  assert.equal(computeOverall({ coverage: 1, correctness: 0, depth: 0, clarity: 0 }), 40);
});

test('needThirdRun: agreement -> no; label differs -> yes; big score gap -> yes', () => {
  const a = run(['covered', 'covered', 'missing'], { correctness: 3, depth: 2, clarity: 3 });
  const b = run(['covered', 'covered', 'missing'], { correctness: 3, depth: 3, clarity: 3 });
  assert.equal(needThirdRun([a, b]), false);
  const c = run(['covered', 'partial', 'missing'], { correctness: 3, depth: 2, clarity: 3 });
  assert.equal(needThirdRun([a, c]), true);
  const d = run(['covered', 'covered', 'missing'], { correctness: 0, depth: 0, clarity: 3 });
  assert.equal(needThirdRun([a, d]), true);
});

test('two agreeing runs: certain, score inside range, evidence merged', () => {
  const ev = { k1: [{ start: 0, end: 15, matchType: 'exact' }] };
  const ev2 = { k1: [{ start: 11, end: 32, matchType: 'exact' }] };
  const r = aggregateRuns(
    [
      run(['covered', 'covered', 'missing'], { correctness: 3, depth: 2, clarity: 3 }, { evidence: ev }),
      run(['covered', 'covered', 'missing'], { correctness: 3, depth: 3, clarity: 3 }, { evidence: ev2 }),
    ],
    KPS,
    ANSWER
  );
  assert.equal(r.uncertain, false);
  assert.ok(r.scoreMin <= r.score && r.score <= r.scoreMax);
  assert.deepEqual(r.keyPoints.map((k) => k.label), ['covered', 'covered', 'missing']);
  assert.equal(r.keyPoints[0].evidence.length, 1); // two overlapping quotes -> one span
  assert.equal(r.keyPoints[0].evidence[0].text, ANSWER.slice(0, 32));
  assert.equal(r.dimensions.depth.value, 2.5);
});

test('three runs, no majority on a key point -> unresolved, uncertain, middle label', () => {
  const r = aggregateRuns(
    [
      run(['covered', 'covered', 'covered'], { correctness: 3, depth: 3, clarity: 3 }),
      run(['covered', 'covered', 'partial'], { correctness: 3, depth: 3, clarity: 3 }),
      run(['covered', 'covered', 'missing'], { correctness: 3, depth: 3, clarity: 3 }),
    ],
    KPS,
    ANSWER
  );
  assert.equal(r.keyPoints[2].label, 'partial');
  assert.equal(r.keyPoints[2].unresolved, true);
  assert.equal(r.uncertain, true);
  assert.match(r.uncertainReasons.join(' '), /portable across environments/);
});

test('wide score spread -> uncertain with the range in the reason', () => {
  const r = aggregateRuns(
    [
      run(['covered', 'covered', 'missing'], { correctness: 4, depth: 4, clarity: 4 }),
      run(['covered', 'covered', 'missing'], { correctness: 1, depth: 1, clarity: 1 }),
      run(['covered', 'covered', 'missing'], { correctness: 2, depth: 2, clarity: 2 }),
    ],
    KPS,
    ANSWER
  );
  assert.equal(r.uncertain, true);
  assert.match(r.uncertainReasons[0], new RegExp(`${r.scoreMin}–${r.scoreMax}`));
});

test('errors: accepted only when a majority of runs quote overlapping text', () => {
  const err = (start, end) => ({ start, end, matchType: 'exact', explanation: 'VMs are not containers' });
  const s = ANSWER.indexOf('VMs are');
  const r = aggregateRuns(
    [
      run(['covered', 'covered', 'missing'], { correctness: 2, depth: 2, clarity: 3 }, { errors: [err(s, s + 20)] }),
      run(['covered', 'covered', 'missing'], { correctness: 2, depth: 2, clarity: 3 }, { errors: [err(s + 4, ANSWER.length)] }),
      run(['covered', 'covered', 'missing'], { correctness: 3, depth: 2, clarity: 3 }, { errors: [err(0, 10)] }),
    ],
    KPS,
    ANSWER
  );
  const accepted = r.errorSpans.filter((e) => e.accepted);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].votes, 2);
  assert.equal(accepted[0].text, ANSWER.slice(s));
  assert.equal(r.errorSpans.find((e) => !e.accepted).votes, 1);
});

test('a run missing a key point counts it as missing', () => {
  const r1 = run(['covered', 'covered', 'covered'], { correctness: 3, depth: 3, clarity: 3 });
  const r2 = { ...run(['covered', 'covered', 'covered'], { correctness: 3, depth: 3, clarity: 3 }) };
  r2.keyPoints = r2.keyPoints.filter((k) => k.id !== 'k3');
  const r = aggregateRuns([r1, r2], KPS, ANSWER);
  assert.deepEqual(r.keyPoints[2].votes, { covered: 1, partial: 0, missing: 1 });
  assert.equal(r.keyPoints[2].label, 'missing'); // even split -> lower (conservative)
});
