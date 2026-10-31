// Runs one resume–JD analysis from start to finish and saves it.
import Analysis from '../models/Analysis.js';
import { redactPII } from './redact.js';
import { extractResumeSkills, extractJdSkills, judgeBorderline, PROMPT_VERSION } from './skills.js';
import { matchSkills, computeScore, cosine, IMPORTANCE_WEIGHT } from './matcher.js';
import { cachedEmbed } from './aiCache.js';
import { modelInfo } from './llm.js';

// Provisional values from a 16-pair spot check with gemini-embedding-001 (all similarities
// fell between 0.81 and 0.95). Final values come from the evaluation set: npm run eval:matcher
export function getThresholds() {
  return {
    high: Number(process.env.MATCH_HIGH || 0.95),
    low: Number(process.env.MATCH_LOW || 0.8),
  };
}

// Embedding models have an input limit (~2048 tokens); whole-document similarity only needs the gist
const DOC_EMBED_CHARS = 6000;

export async function runAnalysis({ user, resumeText: rawResume, resumeFileName, jdText, jdTitle }) {
  // 1. Privacy: redact BEFORE anything is sent to the LLM or stored
  const { text: resumeText, counts: redactions } = redactPII(rawResume, { name: user.name });

  // 2. Skill extraction (cached by hash of text + model + prompt version)
  const [resume, jd] = await Promise.all([extractResumeSkills(resumeText), extractJdSkills(jdText)]);

  // 3. Per-skill matching: exact/alias -> embeddings -> LLM judge for borderline pairs.
  // 4. Whole-document similarity (comparison only) runs at the same time, to save waiting.
  const thresholds = getThresholds();
  const [results, [rv, jv]] = await Promise.all([
    matchSkills({
      jdSkills: jd.skills,
      resumeSkills: resume.skills,
      embed: cachedEmbed,
      judge: judgeBorderline,
      thresholds,
    }),
    cachedEmbed([resumeText.slice(0, DOC_EMBED_CHARS), jdText.slice(0, DOC_EMBED_CHARS)]),
  ]);

  return Analysis.create({
    user: user._id,
    jdTitle: jdTitle || undefined,
    jdText,
    resumeFileName,
    resumeText,
    redactions,
    resumeSkills: resume.skills,
    jdSkills: jd.skills,
    results: results.map(({ exact, ...r }) => r), // "exact" flag is internal only
    matchScore: computeScore(results),
    docSimilarity: Number(cosine(rv, jv).toFixed(4)),
    config: { ...modelInfo(), promptVersion: PROMPT_VERSION, thresholds, weights: IMPORTANCE_WEIGHT },
    cacheHits: { resumeSkills: resume.cacheHit, jdSkills: jd.cacheHit },
  });
}
