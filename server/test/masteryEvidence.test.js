import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidence, priorFor } from '../src/services/mastery/evidence.js';
import { canonicalSkill } from '../src/services/skillNames.js';

const t = (min) => new Date(Date.UTC(2026, 10, 1, 10, min));
const session = (id, start, viewed, questions) => ({ _id: id, createdAt: t(start), resultsViewedAt: viewed == null ? null : t(viewed), questions });
const q = (index, skills, text = `q${index}`, category = 'technical') => ({ index, skills, text, category });
const ans = (sessionId, questionIndex, score, extra = {}) => ({
  _id: `${sessionId}-${questionIndex}`, session: sessionId, questionIndex, status: 'answered', score, scoreConfidence: 1, evaluation: 'e', ...extra,
});

test('skill names are canonicalised: Node / NodeJS / Node.js / node js are ONE skill', () => {
  assert.equal(canonicalSkill('Node'), 'node.js');
  assert.equal(canonicalSkill('NodeJS'), 'node.js');
  assert.equal(canonicalSkill(' Node.JS '), 'node.js');
  assert.equal(canonicalSkill('node js'), 'node.js');
  const ev = buildEvidence({
    sessions: [session('s1', 0, null, [q(0, ['Node']), q(1, ['NodeJS']), q(2, ['Node.js'])])],
    answers: [ans('s1', 0, 70), ans('s1', 1, 80), ans('s1', 2, 90)],
  });
  assert.deepEqual([...ev.keys()], ['node.js']);
  assert.equal(ev.get('node.js').evidence.length, 3);
});

test('weights: confidence × ½ for 2-skill questions × ½ for skipped; not-reached and HR ignored', () => {
  const ev = buildEvidence({
    sessions: [session('s1', 0, null, [q(0, ['Docker']), q(1, ['Docker', 'Git'], 'project q', 'project'), q(2, ['Docker']), q(3, ['Docker']), q(4, [], 'hr q', 'hr')])],
    answers: [
      ans('s1', 0, 80, { scoreConfidence: 0.8 }),
      ans('s1', 1, 60),
      ans('s1', 2, 0, { status: 'skipped' }),
      ans('s1', 3, 0, { status: 'not_reached' }),
      ans('s1', 4, 90),
    ],
  });
  const d = ev.get('docker').evidence;
  assert.deepEqual(d.map((e) => e.weight), [0.8, 0.5, 0.5]);
  assert.equal(d[2].score, 0);
  assert.equal(ev.get('git').evidence[0].weight, 0.5);
  assert.equal(ev.size, 2); // HR added nothing
});

test('unscored answers (no evaluation yet) are not evidence', () => {
  const ev = buildEvidence({ sessions: [session('s1', 0, null, [q(0, ['Docker'])])], answers: [ans('s1', 0, 80, { evaluation: undefined })] });
  assert.equal(ev.size, 0);
});

test('learning only between interviews, and only if the earlier results were viewed first', () => {
  const ev = buildEvidence({
    sessions: [
      session('s1', 0, 30, [q(0, ['Docker']), q(1, ['Docker'])]), // results viewed at minute 30
      session('s2', 60, null, [q(0, ['Docker'])]), // started after -> learning
      session('s3', 90, null, [q(0, ['Docker'])]), // s2 results never viewed -> no learning
    ],
    answers: [ans('s1', 0, 40), ans('s1', 1, 40), ans('s2', 0, 70), ans('s3', 0, 80)],
  });
  assert.deepEqual(ev.get('docker').evidence.map((e) => e.learnBefore), [false, false, true, false]);
});

test('near-duplicate of an already-seen question gets ½ weight; unseen duplicates do not', () => {
  const same = (a, b) => a.replace(/\W/g, '').toLowerCase() === b.replace(/\W/g, '').toLowerCase();
  const text = 'How does Node.js handle I/O on one thread?';
  const ev = buildEvidence({
    sessions: [
      session('s1', 0, null, [q(0, ['Node.js'], text)]), // results NOT viewed
      session('s2', 60, 80, [q(0, ['Node.js'], text)]), // same question, s1 never seen -> full weight
      session('s3', 120, null, [q(0, ['Node.js'], 'how does node.js handle i/o on one thread')]), // seen in s2 -> ½
    ],
    answers: [ans('s1', 0, 50), ans('s2', 0, 60, { shownAt: t(61) }), ans('s3', 0, 90, { shownAt: t(121) })],
    isNearDuplicate: same,
  });
  assert.deepEqual(ev.get('node.js').evidence.map((e) => e.weightParts.repeat), [1, 1, 0.5]);
});

test('model answer opened earlier also counts as "seen"', () => {
  const ev = buildEvidence({
    sessions: [session('s1', 0, null, [q(0, ['Git'], 'same')]), session('s2', 60, null, [q(0, ['Git'], 'same')])],
    answers: [ans('s1', 0, 50, { referenceShownAt: t(20) }), ans('s2', 0, 90, { shownAt: t(61) })],
    isNearDuplicate: (a, b) => a === b,
  });
  assert.deepEqual(ev.get('git').evidence.map((e) => e.weightParts.repeat), [1, 0.5]);
});

test('prior from the most recent analysis that lists the skill (canonical match), else unknown', () => {
  const analyses = [
    { _id: 'old', createdAt: t(0), results: [{ jdSkill: 'NodeJS', status: 'missing' }] },
    { _id: 'new', createdAt: t(50), results: [{ jdSkill: 'Node', canonical: 'node.js', status: 'matched' }] },
  ];
  assert.deepEqual(priorFor('node.js', analyses), { prior: 0.6, source: 'matched', analysis: 'new', name: 'Node' });
  assert.deepEqual(priorFor('kubernetes', analyses), { prior: 0.3, source: 'unknown' });
});

test('a near-identical question on a DIFFERENT skill is not treated as a repeat', () => {
  const ev = buildEvidence({
    sessions: [session('s1', 0, 10, [q(0, ['Docker'], 'same text')]), session('s2', 60, null, [q(0, ['Git'], 'same text')])],
    answers: [ans('s1', 0, 50), ans('s2', 0, 90, { shownAt: t(61) })],
    isNearDuplicate: (a, b) => a === b,
  });
  assert.equal(ev.get('git').evidence[0].weightParts.repeat, 1);
});
