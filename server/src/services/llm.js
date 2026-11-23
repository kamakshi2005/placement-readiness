// The ONLY file that talks to the AI provider (Gemini). Everything else calls
// generateJSON() / embed() / modelInfo(), so switching provider means changing just this file.
//
// Every call names a TASK (extraction, questions, judge, score_a, …). config/models.js maps each
// task to a list of models: the first is used, the others are fallbacks on 429/503. Calls are
// paced per model (requests/minute, calls in flight), counted per day in MongoDB, and can be
// recorded/replayed (llmRecorder.js) so tests don't spend the free-tier quota.
import { GoogleGenAI } from '@google/genai';
import { modelsForTask, EMBED_MODEL, limitsFor } from '../config/models.js';
import { acquireSlot, countRequest, markExhausted, remainingToday, resetInWords } from './aiQuota.js';
import { llmMode, fixtureKey, replay, record } from './llmRecorder.js';

let client;
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not set in server/.env');
    err.status = 500;
    throw err;
  }
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** Models in use (read lazily so scripts that load dotenv later still get the right values) */
export function modelInfo(task = 'extraction') {
  return {
    genModel: modelsForTask(task)[0],
    embedModel: EMBED_MODEL,
    embedDims: Number(process.env.GEMINI_EMBED_DIMS || 768),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Classify a Gemini error. Google's 429 body says WHICH quota was hit:
 * a "...PerDay..." quota id = daily limit (no point retrying today), otherwise per-minute.
 */
export function classifyError(e) {
  const status = e.status ?? e.code;
  let body = null;
  try {
    const msg = String(e.message || '');
    body = JSON.parse(msg.slice(msg.indexOf('{')));
  } catch {
    /* not JSON */
  }
  const details = body?.error?.details || [];
  const quotaIds = details.flatMap((d) => (d['@type']?.includes('QuotaFailure') ? (d.violations || []).map((v) => v.quotaId || '') : []));
  const retry = details.find((d) => d['@type']?.includes('RetryInfo'))?.retryDelay; // e.g. "37s"
  return {
    status,
    daily: status === 429 && quotaIds.some((q) => /PerDay/i.test(q)),
    perMinute: status === 429 && !quotaIds.some((q) => /PerDay/i.test(q)),
    overloaded: status === 503 || status === 500,
    retryAfterMs: retry ? parseFloat(retry) * 1000 : null,
  };
}

/** One model, with retries for short-lived problems. Throws a classified error otherwise. */
export async function callModel(model, request) {
  const remaining = await remainingToday(model);
  if (remaining <= 0) throw Object.assign(new Error(`${model}: daily limit used up`), { kind: 'daily' });

  const delays = [2000, 6000];
  for (let attempt = 0; ; attempt++) {
    const release = await acquireSlot(model);
    // cancel a request that hangs (the SDK has no default timeout)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limitsFor(model).timeoutMs);
    try {
      const res = await request(model, ctrl.signal);
      await countRequest(model);
      return res;
    } catch (e) {
      const timedOut = ctrl.signal.aborted;
      const c = timedOut ? { status: 504, overloaded: true } : classifyError(e);
      if (timedOut || c.status === 429 || c.overloaded) {
        console.log(`[ai] ${model}: ${timedOut ? `no response after ${limitsFor(model).timeoutMs / 1000} s` : c.daily ? 'daily limit' : c.perMinute ? 'per-minute limit' : `HTTP ${c.status}`} (attempt ${attempt + 1})`);
      }
      if (c.status !== 429) await countRequest(model); // non-429 failures still count as a request
      if (c.daily) {
        await markExhausted(model);
        throw Object.assign(new Error(`${model}: daily limit reached (Google)`), { kind: 'daily' });
      }
      // per-minute limit: wait as long as Google asks (max 60 s); overload: short backoff
      if ((c.perMinute || c.overloaded) && attempt < delays.length) {
        await sleep(c.perMinute ? Math.min(c.retryAfterMs ?? 20000, 60000) : delays[attempt]);
        continue;
      }
      if (c.perMinute || c.overloaded) throw Object.assign(new Error(`${model}: ${c.perMinute ? 'rate limited' : 'overloaded'}`), { kind: 'busy' });
      throw Object.assign(new Error(`AI service error (${model}): ${e.message}`), { kind: 'fatal', status: 502 });
    } finally {
      clearTimeout(timer);
      release();
    }
  }
}

/** Try each model of the task in order; return { res, model, fallbackFrom } */
async function withFallback(task, request) {
  const models = modelsForTask(task);
  const problems = [];
  for (const model of models) {
    try {
      const res = await callModel(model, request);
      if (model !== models[0]) console.log(`[ai] ${task}: answered by fallback ${model} (${problems.join('; ')})`);
      return { res, model, fallbackFrom: model !== models[0] ? models[0] : undefined };
    } catch (e) {
      if (e.kind === 'fatal') throw e;
      problems.push(e.message);
    }
  }
  const allDaily = problems.every((p) => /daily/.test(p));
  const err = new Error(
    allDaily
      ? `Today's free AI limit for this step is used up. It resets in ${resetInWords()}.`
      : 'The AI service is busy right now (rate limit or overload). Please try again in a minute.'
  );
  err.status = allDaily ? 429 : 503;
  err.detail = problems;
  throw err;
}

/**
 * Ask the model for JSON that follows `schema` (Gemini structured output).
 * temperature 0 = least random, but NOT fully deterministic — callers cache results.
 * @returns {{ data, meta: { task, model, modelVersion, fallbackFrom?, replayed? } }}
 */
export async function generateJSON({ task, prompt, schema, temperature = 0 }) {
  if (!task) throw new Error('generateJSON needs a task (see config/models.js)');
  const mode = llmMode();
  const key = fixtureKey('generate', { task, prompt, schema, temperature });
  if (mode === 'replay') {
    const r = replay(key, `${task} call`);
    return { data: r.data, meta: { ...r.meta, replayed: true } };
  }

  const { res, model, fallbackFrom } = await withFallback(task, (m, signal) =>
    getClient().models.generateContent({
      model: m,
      contents: prompt,
      config: { temperature, responseMimeType: 'application/json', responseSchema: schema, abortSignal: signal },
    })
  );
  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    throw Object.assign(new Error('AI returned invalid JSON'), { status: 502 });
  }
  // modelVersion = the model that ACTUALLY answered (Google may serve a newer one behind a name)
  const meta = { task, model, modelVersion: res.modelVersion || model, ...(fallbackFrom && { fallbackFrom }) };
  if (mode === 'record') record(key, { kind: 'generate', task, promptStart: prompt.slice(0, 300) }, { data, meta });
  return { data, meta };
}

async function embedRequest(contents) {
  const { embedModel, embedDims } = modelInfo();
  return callModel(embedModel, (m, signal) =>
    getClient().models.embedContent({ model: m, contents, config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: embedDims, abortSignal: signal } })
  ).catch((e) => {
    throw Object.assign(new Error(e.kind === 'daily' ? `Today's free embedding limit is used up. It resets in ${resetInWords()}.` : e.message), {
      status: e.kind === 'daily' ? 429 : e.status || 503,
    });
  });
}

/** Embed many short texts. Returns one vector (array of numbers) per text, same order. */
export async function embed(texts) {
  const mode = llmMode();
  const { embedModel, embedDims } = modelInfo();
  const key = fixtureKey('embed', { embedModel, embedDims, texts });
  if (mode === 'replay') return replay(key, `embedding of ${texts.length} text(s)`).vectors;

  const out = [];
  // gemini-embedding-001 takes up to 100 texts per request and returns one vector each.
  // gemini-embedding-2 (multimodal) merges a list into ONE vector, so it needs one request
  // per text — detected by the count not matching.
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await embedRequest(batch);
    if (res.embeddings.length === batch.length) {
      out.push(...res.embeddings.map((e) => e.values));
      continue;
    }
    for (const t of batch) out.push((await embedRequest(t)).embeddings[0].values);
  }
  // rounded in fixtures to keep files small (cosine is unaffected at 5 decimals)
  if (mode === 'record') record(key, { kind: 'embed', count: texts.length }, { vectors: out.map((v) => v.map((x) => Math.round(x * 1e5) / 1e5)) });
  return out;
}
