// Record / replay of AI calls, so development and tests don't burn the daily free-tier quota.
//
//   LLM_MODE=live    (default for the running app) real calls, nothing saved
//   LLM_MODE=record  real calls, every response also saved as a fixture file
//   LLM_MODE=replay  no real calls: responses come from fixtures; a missing fixture is an error
//
// Scripts and tests default to replay (see defaultScriptMode). Fixture files live in
// test/fixtures/llm/ (override with LLM_FIXTURES_DIR) and are committed, so tests run offline.
// PRIVACY: never record with real personal data — fixtures contain the full prompt.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'llm');
const fixturesDir = () => process.env.LLM_FIXTURES_DIR || DEFAULT_DIR;

export function llmMode() {
  const m = (process.env.LLM_MODE || 'live').toLowerCase();
  if (!['live', 'record', 'replay'].includes(m)) throw new Error(`LLM_MODE must be live, record or replay (got "${m}")`);
  return m;
}

/** For scripts: replay unless the user explicitly asked for --live or --record */
export function defaultScriptMode(argv = process.argv) {
  if (process.env.LLM_MODE) return;
  process.env.LLM_MODE = argv.includes('--record') ? 'record' : argv.includes('--live') ? 'live' : 'replay';
}

/** Stable fixture key from what determines the answer (NOT the model chosen by fallback) */
export function fixtureKey(kind, payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ kind, ...payload })).digest('hex').slice(0, 32);
}

const fileFor = (key) => path.join(fixturesDir(), `${key}.json`);
const replayCounter = new Map(); // key -> how many times replayed in this process

/** Next recorded response for this key (cycles through recordings), or throws */
export function replay(key, describe) {
  const file = fileFor(key);
  if (!fs.existsSync(file)) {
    const err = new Error(`No recorded AI response for ${describe} (fixture ${key}). Run once with LLM_MODE=record (or --record) to create it.`);
    err.status = 500;
    err.code = 'NO_FIXTURE';
    throw err;
  }
  const { responses } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const n = replayCounter.get(key) || 0;
  replayCounter.set(key, n + 1);
  return responses[n % responses.length];
}

/** Append a live response to the fixture for this key */
export function record(key, info, response) {
  fs.mkdirSync(fixturesDir(), { recursive: true });
  const file = fileFor(key);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ...info, responses: [] };
  existing.responses.push({ ...response, recordedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(existing, null, 1));
}
