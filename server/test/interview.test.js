import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMultiPart, normalizeKeyPoints } from '../src/services/questionGenerator.js';
import { buildPlan } from '../src/services/interviewPlanner.js';

test('isMultiPart flags two-part questions and keeps single ones', () => {
  assert.equal(isMultiPart('What is Docker, and how does it differ from a VM?'), true);
  assert.equal(isMultiPart('What is OAuth? How does it differ from Basic auth?'), true);
  assert.equal(isMultiPart('How does a Docker container differ from a virtual machine?'), false);
  assert.equal(isMultiPart('Why would you choose PostgreSQL over MySQL and MongoDB here?'), false);
});

test('normalizeKeyPoints handles old string lists and new {id,text} lists', () => {
  assert.deepEqual(normalizeKeyPoints(['a', 'b']), [{ id: 'k1', text: 'a' }, { id: 'k2', text: 'b' }]);
  assert.deepEqual(normalizeKeyPoints([{ id: 'k7', text: 'x' }]), [{ id: 'k7', text: 'x' }]);
});

const R = (jdSkill, importance, status) => ({ jdSkill, canonical: jdSkill.toLowerCase(), importance, status });
const analysis = {
  results: [
    R('Node.js', 'required', 'matched'),
    R('TypeScript', 'required', 'partial'),
    R('REST API', 'required', 'matched'),
    R('Docker', 'required', 'missing'),
    R('AWS', 'nice_to_have', 'missing'),
  ],
};

test('gap mode: gaps first (required missing before partial), then matched', () => {
  const { plan } = buildPlan({ analysis, mode: 'gap', preset: 'standard' });
  const tech = plan.filter((q) => q.category === 'technical');
  assert.deepEqual(tech.map((q) => q.skills[0]), ['Docker', 'TypeScript', 'AWS', 'Node.js', 'REST API']);
  assert.deepEqual(tech.map((q) => q.difficulty), ['easy', 'medium', 'easy', 'medium', 'medium']);
  assert.equal(plan.length, 8);
});

test('study preset is 4/1/1 and an empty JD is rejected', () => {
  const { plan, counts } = buildPlan({ analysis, mode: 'gap', preset: 'study' });
  assert.deepEqual(counts, { technical: 4, project: 1, hr: 1 });
  assert.equal(plan.length, 6);
  assert.throws(() => buildPlan({ analysis: { results: [] }, mode: 'gap', preset: 'standard' }), /no JD skills/);
});
