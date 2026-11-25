// Beta distribution maths for the mastery score curves (Phase 2). Pure functions, unit-tested.
// A Beta(a, b) distribution lives on 0..1 — a natural model for score/100, which is bounded and
// piles up near the ends.

/** log Γ(x), Lanczos approximation (accurate to ~1e-15 for x > 0) */
export function lgamma(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x); // reflection
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const logBetaFn = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);

/** Density of Beta(a, b) at x (0 < x < 1) */
export function betaPdf(x, a, b) {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - logBetaFn(a, b));
}

/** Continued fraction for the incomplete beta function (modified Lentz) */
function betacf(a, b, x) {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Cumulative probability P(X ≤ x) for X ~ Beta(a, b) (regularised incomplete beta function) */
export function betaCdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBetaFn(a, b));
  // the continued fraction converges fast on one side of the mean; use symmetry on the other
  return x < (a + 1) / (a + b + 2) ? (front * betacf(a, b, x)) / a : 1 - (front * betacf(b, a, 1 - x)) / b;
}

// ---------------- score curves ----------------
// A curve = Beta(a, b) mixed with a small uniform part (weight eps):
//   density(s) = (1 − eps)·Beta(s) + eps
// The uniform part caps how strong one answer's evidence can be (a pure Beta density goes to 0 at
// the ends, which would make a single 0 or 100 almost certain proof).

export function curveDensity(s, { a, b, eps }) {
  return (1 - eps) * betaPdf(s, a, b) + eps;
}
export function curveCdf(s, { a, b, eps }) {
  return (1 - eps) * betaCdf(s, a, b) + eps * Math.min(1, Math.max(0, s));
}

/**
 * One-sided score curves, each with ONE parameter fitted from guess or slip:
 *   tail 'below' -> mastered curve Beta(a, 1): density RISES towards 100;
 *                   a is chosen so that P(score < cut) = target (= slip)
 *   tail 'above' -> not-mastered curve Beta(1, b): density FALLS from 0;
 *                   b is chosen so that P(score ≥ cut) = target (= guess)
 * Why these shapes: with a hump-shaped mastered curve, a perfect 100 counted as WEAKER evidence
 * than a 90 (the density drops near 1). With a ≥ 1 = b_mastered and b ≥ 1 = a_notMastered, a higher
 * score is always at least as much evidence of mastery (monotone likelihood ratio), also with
 * the uniform part mixed in. Solved by bisection on the free parameter (a larger value = smaller tail).
 */
export function fitCurve({ cut, tail, target, eps }) {
  const shape = (k) => (tail === 'below' ? { a: k, b: 1, eps } : { a: 1, b: k, eps });
  const tailProb = (k) => {
    const below = curveCdf(cut, shape(k));
    return tail === 'below' ? below : 1 - below;
  };
  let lo = 0.5;
  let hi = 2000;
  if (tailProb(hi) > target || tailProb(lo) < target) {
    throw new Error(`Cannot fit a curve with ${tail}-tail ${target} at ${cut} (eps ${eps})`);
  }
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi); // bisection on a log scale
    if (tailProb(mid) > target) lo = mid;
    else hi = mid;
  }
  return shape(Math.sqrt(lo * hi));
}
