// Small statistics helpers for the evaluation scripts (pure, unit-tested).

export const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);

/** Sample standard deviation (n - 1) */
export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((t, x) => t + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Ranks with ties given their average rank (1-based) */
export function ranks(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

/** Spearman rank correlation (Pearson on tie-averaged ranks) */
export const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));

/** Cohen's kappa for two raters over the same items (any category labels) */
export function cohenKappa(a, b) {
  const n = a.length;
  if (!n) return NaN;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((t, c) => t + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Precision / recall / F1 from counts */
export function prf(tp, fp, fn) {
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  return { precision: p, recall: r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
}
