import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findQuote, mergeSpans } from '../src/services/scoring/evidence.js';

const answer = `Docker packages an app with its dependencies into an image.
Containers share the host OS kernel, so they start in seconds — unlike “virtual machines”.`;

test('exact quote -> exact span', () => {
  const s = findQuote(answer, 'share the host OS kernel');
  assert.equal(s.matchType, 'exact');
  assert.equal(answer.slice(s.start, s.end), 'share the host OS kernel');
});

test('different case, quotes, dashes and spacing -> normalized match maps back to original text', () => {
  const s = findQuote(answer, 'they start in seconds - unlike "virtual   machines"');
  assert.equal(s.matchType, 'normalized');
  assert.equal(answer.slice(s.start, s.end), 'they start in seconds — unlike “virtual machines”');
});

test('quote across a line break', () => {
  const s = findQuote(answer, 'into an image. Containers share');
  assert.equal(s.matchType, 'normalized');
  assert.equal(answer.slice(s.start, s.end), 'into an image.\nContainers share');
});

test('small paraphrase -> fuzzy match', () => {
  const s = findQuote(answer, 'Containers share the host kernel, so they start in seconds');
  assert.equal(s.matchType, 'fuzzy');
  assert.match(answer.slice(s.start, s.end), /^Containers share the host OS kernel, so they start in seconds$/);
});

test('invented quote -> null (dropped)', () => {
  assert.equal(findQuote(answer, 'Kubernetes schedules pods across nodes automatically'), null);
});

test('too-short quote is never fuzzy-matched', () => {
  assert.equal(findQuote(answer, 'VM kernel'), null);
});

test('empty inputs -> null', () => {
  assert.equal(findQuote(answer, ''), null);
  assert.equal(findQuote('', 'anything'), null);
});

test('mergeSpans merges overlaps and keeps the weakest match type', () => {
  const text = 'abcdefghijklmnop';
  const merged = mergeSpans(
    [
      { start: 5, end: 9, matchType: 'exact' },
      { start: 0, end: 6, matchType: 'fuzzy' },
      { start: 12, end: 14, matchType: 'exact' },
    ],
    text
  );
  assert.deepEqual(
    merged.map(({ start, end, matchType, text: t }) => [start, end, matchType, t]),
    [
      [0, 9, 'fuzzy', 'abcdefghi'],
      [12, 14, 'exact', 'mn'],
    ]
  );
});
