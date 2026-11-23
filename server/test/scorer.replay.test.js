// Runs the REAL scoring pipeline (prompts, quote verification, aggregation) on recorded AI
// responses — no network, no quota. Re-record with:
//   LLM_MODE=record node --input-type=module -e "…scoreAnswerText(fixture)…"  (see CLAUDE.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

process.env.LLM_MODE = 'replay';
const { scoreAnswerText } = await import('../src/services/scoring/scorer.js');
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/scorer-docker.json', import.meta.url), 'utf8'));

test('scoring pipeline on recorded responses: runs, models, evidence, error, range', async () => {
  const r = await scoreAnswerText(fx);

  // runs A and B on different models; every run says which model + version answered
  assert.ok(r.runs.length >= 2);
  assert.notEqual(r.runs[0].model, r.runs[1].model);
  assert.ok(r.runs.every((run) => run.model && run.modelVersion && run.kpOrder.length === 4));
  assert.deepEqual(r.runs.map((x) => x.variant), ['A', 'B', 'C'].slice(0, r.runs.length));

  // the answer covers k1 + k2 and claims the OPPOSITE of k4 (contradiction must never count as covered)
  const label = Object.fromEntries(r.keyPoints.map((k) => [k.id, k.label]));
  assert.equal(label.k1, 'covered');
  assert.equal(label.k2, 'covered');
  assert.notEqual(label.k4, 'covered');

  // evidence spans really are text from the answer, at the stored offsets
  for (const k of r.keyPoints) for (const e of k.evidence) assert.equal(fx.answer.slice(e.start, e.end), e.text);

  // the false "more secure" claim is an accepted error
  const accepted = r.errorSpans.filter((e) => e.accepted);
  assert.equal(accepted.length, 1);
  assert.match(accepted[0].text, /more secure/);

  assert.ok(r.scoreMin <= r.score && r.score <= r.scoreMax);
  assert.equal(r.quoteStats.dropped, 0);
});
