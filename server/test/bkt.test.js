import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bayesUpdate, likelihoods, traceSkill, masteryRange, learnStep, curvesFor } from '../src/services/mastery/bkt.js';
import { curveCdf } from '../src/utils/beta.js';
import { PARAMS } from '../src/config/mastery.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('threshold model = textbook BKT update (hand-calculated)', () => {
  // prior 0.3, correct answer: 0.3·0.9 / (0.3·0.9 + 0.7·0.2) = 0.27 / 0.41
  near(bayesUpdate(0.3, likelihoods(75, PARAMS, 'threshold'), 1), 0.27 / 0.41);
  // incorrect: 0.3·0.1 / (0.3·0.1 + 0.7·0.8) = 0.03 / 0.59
  near(bayesUpdate(0.3, likelihoods(40, PARAMS, 'threshold'), 1), 0.03 / 0.59);
});

test('weight 0 changes nothing, weight 1 is the full update, ½ lies in between', () => {
  const L = likelihoods(85, PARAMS);
  const full = bayesUpdate(0.3, L, 1);
  const half = bayesUpdate(0.3, L, 0.5);
  near(bayesUpdate(0.3, L, 0), 0.3);
  assert.ok(0.3 < half && half < full);
});

test('continuous curves keep the guess/slip meaning', () => {
  const c = curvesFor(PARAMS);
  near(curveCdf(0.6, c.mastered), PARAMS.slip, 1e-6);
  near(1 - curveCdf(0.6, c.notMastered), PARAMS.guess, 1e-6);
});

test('continuous evidence: higher scores always point more towards mastery; extremes stay bounded', () => {
  let prev = 0;
  for (const s of [0, 20, 40, 60, 75, 90, 100]) {
    const p = bayesUpdate(0.5, likelihoods(s, PARAMS), 1);
    assert.ok(p > prev, `score ${s} should give more than the previous score`);
    prev = p;
  }
  // the uniform part caps one answer's strength: even a 0 leaves some chance of mastery
  assert.ok(bayesUpdate(0.5, likelihoods(0, PARAMS), 1) > 0.005);
  assert.ok(bayesUpdate(0.5, likelihoods(100, PARAMS), 1) < 0.995);
});

test('learning applies only where learnBefore is set (between interviews, results viewed)', () => {
  const ev = [
    { score: 30, weight: 1, session: 'a' },
    { score: 30, weight: 1, session: 'a' }, // same interview: no learning
    { score: 30, weight: 1, session: 'b', learnBefore: true },
  ];
  const { steps } = traceSkill(0.3, ev);
  near(steps[1].pBefore, steps[0].pAfter);
  near(steps[2].pBefore, learnStep(steps[1].pAfter, PARAMS.learn));
});

test('consistent strong evidence -> high mastery and a NARROW range; little evidence -> wide range', () => {
  const one = [{ score: 90, weight: 1, session: 'a' }];
  const many = Array.from({ length: 6 }, (_, i) => ({ score: 92, weight: 1, session: `s${i}`, learnBefore: i > 0 }));
  const r1 = masteryRange(0.35, one, { seed: 'u|docker' });
  const r6 = masteryRange(0.35, many, { seed: 'u|docker' });
  assert.ok(traceSkill(0.35, many).p > 0.95);
  assert.ok(r6.high - r6.low < r1.high - r1.low, `range should narrow: ${JSON.stringify(r1)} -> ${JSON.stringify(r6)}`);
  assert.ok(r6.low <= traceSkill(0.35, many).p + 0.05);
  // same seed -> same range (stable display)
  assert.deepEqual(masteryRange(0.35, one, { seed: 'u|docker' }), r1);
});
