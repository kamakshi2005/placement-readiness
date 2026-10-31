// The ONLY file that talks to the AI provider (Gemini). Everything else calls
// generateJSON() / embed() / modelInfo(), so switching provider means changing just this file.
import { GoogleGenAI } from '@google/genai';

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

// Read lazily so scripts that load dotenv later still get the right values
export function modelInfo() {
  return {
    // gemini-2.5-flash is closed to new API keys (checked Oct 2026)
    genModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    embedDims: Number(process.env.GEMINI_EMBED_DIMS || 768),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Free tier: 429 = rate limit, 503 = model overloaded. Retry a couple of times, then give up
// with a clear message instead of a raw stack trace.
async function withRetry(fn) {
  const delays = [2000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = e.status ?? e.code;
      const retryable = code === 429 || code === 500 || code === 503;
      if (retryable && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      const err = new Error(
        code === 429
          ? 'AI rate limit reached (free tier). Please wait a minute and try again.'
          : `AI service error: ${e.message}`
      );
      err.status = code === 429 ? 429 : 502;
      throw err;
    }
  }
}

/**
 * Ask the model for JSON that follows `schema` (Gemini structured output).
 * temperature 0 = least random, but NOT fully deterministic — callers cache results.
 */
export async function generateJSON({ prompt, schema, temperature = 0 }) {
  const { genModel } = modelInfo();
  const res = await withRetry(() =>
    getClient().models.generateContent({
      model: genModel,
      contents: prompt,
      config: { temperature, responseMimeType: 'application/json', responseSchema: schema },
    })
  );
  try {
    return JSON.parse(res.text);
  } catch {
    const err = new Error('AI returned invalid JSON');
    err.status = 502;
    throw err;
  }
}

function embedRequest(contents) {
  const { embedModel, embedDims } = modelInfo();
  return withRetry(() =>
    getClient().models.embedContent({
      model: embedModel,
      contents,
      config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: embedDims },
    })
  );
}

/** Embed many short texts. Returns one vector (array of numbers) per text, same order. */
export async function embed(texts) {
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
    for (let j = 0; j < batch.length; j += 5) {
      // 5 at a time, to stay under free-tier per-minute limits
      const group = await Promise.all(batch.slice(j, j + 5).map((t) => embedRequest(t)));
      out.push(...group.map((r) => r.embeddings[0].values));
    }
  }
  return out;
}
