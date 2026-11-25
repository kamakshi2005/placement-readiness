import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lgamma, betaPdf, betaCdf, fitCurve, curveCdf } from '../src/utils/beta.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('lgamma matches known values', () => {
  near(lgamma(1), 0);
  near(lgamma(5), Math.log(24)); // Γ(5) = 4!
  near(lgamma(0.5), Math.log(Math.sqrt(Math.PI)));
});

test('betaPdf and betaCdf match closed forms', () => {
  near(betaPdf(0.3, 1, 1), 1); // uniform
  near(betaPdf(0.5, 2, 2), 1.5); // 6x(1−x)
  near(betaCdf(0.3, 1, 1), 0.3);
  near(betaCdf(0.5, 2, 2), 0.5); // symmetric
  near(betaCdf(0.5, 2, 3), 0.6875); // 1 − (1−x)^3·(1+3x) at 0.5
  near(betaCdf(0.2, 3, 1), 0.008); // x^3
  near(betaCdf(0.9, 8, 2) + (1 - betaCdf(0.9, 8, 2)), 1);
});

test('betaCdf is monotone and bounded', () => {
  let prev = 0;
  for (let x = 0; x <= 1.0001; x += 0.05) {
    const c = betaCdf(x, 7.3, 2.1);
    assert.ok(c >= prev - 1e-12 && c <= 1);
    prev = c;
  }
});

test('fitCurve hits the requested guess / slip tails (with the uniform part included)', () => {
  const eps = 0.05;
  const mastered = fitCurve({ cut: 0.6, tail: 'below', target: 0.1, eps });
  near(curveCdf(0.6, mastered), 0.1, 1e-6); // P(score < 60 | mastered) = slip
  assert.equal(mastered.b, 1); // rises towards 100
  const notMastered = fitCurve({ cut: 0.6, tail: 'above', target: 0.2, eps });
  near(1 - curveCdf(0.6, notMastered), 0.2, 1e-6); // P(score ≥ 60 | not mastered) = guess
  assert.equal(notMastered.a, 1); // falls from 0
  assert.throws(() => fitCurve({ cut: 0.6, tail: 'above', target: 0.9, eps }), /Cannot fit/);
});
