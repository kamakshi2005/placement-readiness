import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranks, spearman, cohenKappa, sd, prf } from '../src/utils/stats.js';
import { toCSV, parseCSV } from '../src/utils/csv.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('ranks average ties', () => {
  assert.deepEqual(ranks([10, 20, 20, 5]), [2, 3.5, 3.5, 1]);
});

test('spearman: perfect, reversed, and with ties', () => {
  near(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  near(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  near(spearman([3, 2, 2, 1, 1], [90, 60, 70, 20, 30]), 0.9486832980505138);
});

test('cohen kappa: perfect agreement = 1, chance-level = 0', () => {
  near(cohenKappa(['a', 'b', 'a'], ['a', 'b', 'a']), 1);
  near(cohenKappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b']), 0);
});

test('sd and prf', () => {
  near(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395);
  assert.deepEqual(prf(8, 2, 0), { precision: 0.8, recall: 1, f1: 0.888888888888889 });
});

test('CSV round trip keeps quotes, commas, line breaks and unicode', () => {
  const rows = [
    { id: '1', answer: 'He said "hi", then\nleft.', note: '' },
    { id: '2', answer: '₹500 — “smart quotes”', note: 'ok' },
  ];
  const csv = toCSV(rows, ['id', 'answer', 'note']);
  assert.ok(csv.startsWith('﻿'));
  assert.deepEqual(parseCSV(csv), rows);
});

test('parseCSV handles Excel CRLF and trailing blank lines', () => {
  assert.deepEqual(parseCSV('a,b\r\n1,x\r\n2,"y, z"\r\n\r\n'), [
    { a: '1', b: 'x' },
    { a: '2', b: 'y, z' },
  ]);
});
