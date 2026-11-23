import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { classifyError } from '../src/services/llm.js';
import { dayKey, msUntilReset, acquireSlot } from '../src/services/aiQuota.js';
import { fixtureKey, record, replay } from '../src/services/llmRecorder.js';
import { modelsForTask, limitsFor } from '../src/config/models.js';

// Google's 429 body, as the SDK puts it in error.message
const quota429 = (quotaId, retry = '37s') => ({
  status: 429,
  message: JSON.stringify({
    error: {
      code: 429,
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry },
      ],
    },
  }),
});

test('classifyError tells daily limits from per-minute limits and overload', () => {
  const d = classifyError(quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '1643s'));
  assert.equal(d.daily, true);
  assert.equal(d.perMinute, false);
  const m = classifyError(quota429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '12s'));
  assert.equal(m.daily, false);
  assert.equal(m.perMinute, true);
  assert.equal(m.retryAfterMs, 12000);
  const o = classifyError({ status: 503, message: 'high demand' });
  assert.equal(o.overloaded, true);
  assert.equal(o.daily, false);
});

test('quota day is the Pacific date, and the reset is within 24 h', () => {
  // 07:55 UTC on 23 Nov = 23:55 on 22 Nov in Los Angeles
  assert.equal(dayKey(new Date('2026-11-23T07:55:00Z')), '2026-11-22');
  assert.equal(dayKey(new Date('2026-11-23T08:05:00Z')), '2026-11-23');
  const ms = msUntilReset(new Date('2026-11-23T07:55:00Z'));
  assert.ok(ms > 4 * 60000 && ms <= 6 * 60000, `expected ~5 min, got ${ms / 60000} min`);
});

test('task routing: scoring runs A and B use different models; unknown task throws', () => {
  assert.notEqual(modelsForTask('score_a')[0], modelsForTask('score_b')[0]);
  assert.equal(modelsForTask('extraction')[0], 'gemini-3.5-flash');
  assert.throws(() => modelsForTask('nope'), /Unknown AI task/);
  assert.equal(limitsFor('gemini-3.5-flash').rpd, 20);
});

test('record then replay returns the saved responses in turn; missing fixture is a clear error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmfix-'));
  process.env.LLM_FIXTURES_DIR = dir;
  try {
    const key = fixtureKey('generate', { task: 't', prompt: 'p', schema: {}, temperature: 0 });
    assert.equal(key, fixtureKey('generate', { task: 't', prompt: 'p', schema: {}, temperature: 0 })); // stable
    assert.notEqual(key, fixtureKey('generate', { task: 't', prompt: 'p2', schema: {}, temperature: 0 }));
    record(key, { kind: 'generate' }, { data: { n: 1 } });
    record(key, { kind: 'generate' }, { data: { n: 2 } });
    assert.deepEqual([replay(key, 'x').data.n, replay(key, 'x').data.n, replay(key, 'x').data.n], [1, 2, 1]);
    assert.throws(() => replay(fixtureKey('generate', { other: 1 }), 'missing call'), (e) => e.code === 'NO_FIXTURE' && /LLM_MODE=record/.test(e.message));
  } finally {
    delete process.env.LLM_FIXTURES_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pacing never runs more calls at once than the model allows', async () => {
  const model = 'gemini-3.5-flash-lite'; // concurrency 3
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      const release = await acquireSlot(model);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      release();
    })
  );
  // 8 calls fit in the 15/minute limit, so only concurrency limits them
  assert.equal(peak, limitsFor(model).concurrency);
});

test('a hung request is cancelled by the timeout, retried, then reported as busy (so fallback can run)', async () => {
  const { callModel } = await import('../src/services/llm.js');
  const { MODEL_LIMITS } = await import('../src/config/models.js');
  MODEL_LIMITS['test-hang-model'] = { rpm: 100, rpd: 100, concurrency: 1, timeoutMs: 100 };
  let attempts = 0;
  let aborted = 0;
  const hang = (model, signal) =>
    new Promise((_, reject) => {
      attempts++;
      signal.addEventListener('abort', () => {
        aborted++;
        reject(new Error('aborted'));
      });
    });
  await assert.rejects(callModel('test-hang-model', hang), (e) => e.kind === 'busy');
  assert.equal(attempts, 3); // first try + 2 retries
  assert.equal(aborted, 3); // every attempt was actually cancelled
  delete MODEL_LIMITS['test-hang-model'];
});
