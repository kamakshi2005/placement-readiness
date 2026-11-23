// Cached wrappers around llm.js. Same input + same task model + same prompt version
// -> same stored answer, every time.
// The key uses the task's PRIMARY model name (not a fallback that happened to answer), so a
// fallback doesn't create a second cache entry; which model really answered is kept in `meta`.
import crypto from 'crypto';
import LlmCache from '../models/LlmCache.js';
import { embed, modelInfo } from './llm.js';
import { modelsForTask } from '../config/models.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Run `fn` only if there is no cached result for (kind, task model, promptVersion, input).
 * fn() must return { data, meta } (as generateJSON does).
 * @returns {{ value, cacheHit, meta }}
 */
export async function cachedCall({ kind, task, promptVersion, input, fn }) {
  const model = modelsForTask(task)[0];
  const key = sha256([kind, model, promptVersion, input].join('|'));

  const hit = await LlmCache.findOne({ key }).lean();
  if (hit) return { value: hit.value, cacheHit: true, meta: hit.meta || { model: hit.model } };

  const { data, meta } = await fn();
  // upsert: two requests racing on the same input won't fail on the unique key
  await LlmCache.updateOne({ key }, { $setOnInsert: { key, kind, model, value: data, meta } }, { upsert: true });
  return { value: data, cacheHit: false, meta };
}

/**
 * Like cachedCall, but for many small inputs answered in ONE API call
 * (used by the borderline judge). fn(uncachedInputs) must return { values, meta } with values
 * in the same order as the inputs.
 */
export async function cachedBatch({ kind, task, promptVersion, inputs, fn }) {
  const model = modelsForTask(task)[0];
  const keyOf = (input) => sha256([kind, model, promptVersion, input].join('|'));
  const keys = inputs.map(keyOf);

  const found = await LlmCache.find({ key: { $in: keys } }).lean();
  const byKey = new Map(found.map((d) => [d.key, d.value]));

  const missing = [...new Set(inputs.filter((inp, i) => !byKey.has(keys[i])))];
  if (missing.length) {
    const { values, meta } = await fn(missing);
    await LlmCache.bulkWrite(
      missing.map((inp, i) => ({
        updateOne: {
          filter: { key: keyOf(inp) },
          update: { $setOnInsert: { key: keyOf(inp), kind, model, value: values[i], meta } },
          upsert: true,
        },
      }))
    );
    missing.forEach((inp, i) => byKey.set(keyOf(inp), values[i]));
  }
  return keys.map((k) => byKey.get(k));
}

/** Embeddings with a per-text cache: only texts never seen before go to the API. */
export async function cachedEmbed(texts) {
  const { embedModel, embedDims } = modelInfo();
  const keyOf = (t) => sha256(['embedding', embedModel, embedDims, t].join('|'));
  const keys = texts.map(keyOf);

  const found = await LlmCache.find({ key: { $in: keys } }).lean();
  const byKey = new Map(found.map((d) => [d.key, d.value]));

  const missing = [...new Set(texts.filter((t, i) => !byKey.has(keys[i])))];
  if (missing.length) {
    const vecs = await embed(missing);
    await LlmCache.bulkWrite(
      missing.map((t, i) => ({
        updateOne: {
          filter: { key: keyOf(t) },
          update: { $setOnInsert: { key: keyOf(t), kind: 'embedding', model: embedModel, value: vecs[i] } },
          upsert: true,
        },
      }))
    );
    missing.forEach((t, i) => byKey.set(keyOf(t), vecs[i]));
  }
  return keys.map((k) => byKey.get(k));
}
