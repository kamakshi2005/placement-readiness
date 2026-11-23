// Skill matcher: decides, for every JD skill, whether the resume covers it.
//
// Pipeline per JD skill:
//   1. exact match after normalization + alias map      -> matched (method "exact" / "alias")
//   2. otherwise embedding cosine similarity with the closest resume skill
//        similarity >= high                             -> matched  (method "embedding")
//        similarity <  low                              -> missing  (method "embedding")
//        in between                                     -> borderline -> LLM judge (method "llm")
//
// The functions here take `embed` and `judge` as parameters instead of importing the LLM
// service, so the evaluation script can run the exact same code with cached results.

import { canonicalSkill } from './skillNames.js';

export const IMPORTANCE_WEIGHT = { required: 2, nice_to_have: 1 };
export const STATUS_CREDIT = { matched: 1, partial: 0.5, missing: 0 };

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Remove duplicates by canonical name. For JD skills, "required" wins over "nice_to_have". */
export function dedupeSkills(jdSkills, resumeSkills) {
  const jd = new Map();
  for (const s of jdSkills) {
    const key = canonicalSkill(s.name);
    if (!key) continue;
    const prev = jd.get(key);
    if (!prev || (prev.importance !== 'required' && s.importance === 'required')) {
      jd.set(key, { name: s.name, importance: s.importance === 'required' ? 'required' : 'nice_to_have', canonical: key });
    }
  }
  const res = new Map();
  for (const name of resumeSkills) {
    const key = canonicalSkill(name);
    if (key && !res.has(key)) res.set(key, { name, canonical: key });
  }
  return { jd: [...jd.values()], resume: [...res.values()] };
}

/**
 * Step 1 + similarity part of step 2. Threshold-independent, so the evaluation
 * script can compute this once and then try many thresholds.
 */
export async function findCandidates({ jdSkills, resumeSkills, embed }) {
  const { jd, resume } = dedupeSkills(jdSkills, resumeSkills);
  const exact = new Map(resume.map((r) => [r.canonical, r]));

  // Only JD skills without an exact match need embeddings
  const needEmbedding = jd.filter((j) => !exact.has(j.canonical));
  let vectors = new Map();
  if (needEmbedding.length && resume.length) {
    const texts = [...new Set([...needEmbedding.map((j) => j.canonical), ...resume.map((r) => r.canonical)])];
    const vecs = await embed(texts);
    vectors = new Map(texts.map((t, i) => [t, vecs[i]]));
  }

  return jd.map((j) => {
    const base = { jdSkill: j.name, canonical: j.canonical, importance: j.importance };
    const hit = exact.get(j.canonical);
    if (hit) {
      // "alias" if the raw names differed (e.g. "JS" vs "JavaScript"), else "exact"
      const sameText = hit.name.trim().toLowerCase() === j.name.trim().toLowerCase();
      return { ...base, exact: true, method: sameText ? 'exact' : 'alias', resumeSkill: hit.name, similarity: 1 };
    }
    let best = null;
    for (const r of resume) {
      const sim = cosine(vectors.get(j.canonical), vectors.get(r.canonical));
      if (!best || sim > best.similarity) best = { resumeSkill: r.name, similarity: sim };
    }
    return { ...base, exact: false, method: 'embedding', resumeSkill: best?.resumeSkill ?? null, similarity: best?.similarity ?? 0 };
  });
}

/** Apply the two thresholds. Returns statuses matched / missing / borderline. */
export function classify(candidates, { high, low }) {
  return candidates.map((c) => {
    if (c.exact) return { ...c, status: 'matched' };
    if (c.similarity >= high) return { ...c, status: 'matched' };
    // resumeSkill is kept on missing results as "closest resume skill", for the explanation
    if (c.similarity < low || !c.resumeSkill) return { ...c, status: 'missing' };
    return { ...c, status: 'borderline' };
  });
}

/**
 * Ask the LLM judge about all borderline pairs in one go.
 * judge([{ jdSkill, resumeSkill }]) -> [{ verdict: 'yes'|'partial'|'no', reason }]
 */
export async function resolveBorderline(results, judge) {
  const borderline = results.filter((r) => r.status === 'borderline');
  if (!borderline.length) return results;

  const verdicts = await judge(borderline.map((r) => ({ jdSkill: r.canonical, resumeSkill: canonicalSkill(r.resumeSkill) })));
  const STATUS = { yes: 'matched', partial: 'partial', no: 'missing' };
  let i = 0;
  return results.map((r) => {
    if (r.status !== 'borderline') return r;
    const v = verdicts[i++] || { verdict: 'no', reason: 'No verdict returned' };
    return { ...r, status: STATUS[v.verdict] || 'missing', method: 'llm', reason: v.reason, judgeModel: v.modelVersion || v.model || 'unknown (pre-versioning)' };
  });
}

/** Full pipeline used by the app. */
export async function matchSkills({ jdSkills, resumeSkills, embed, judge, thresholds }) {
  const candidates = await findCandidates({ jdSkills, resumeSkills, embed });
  const classified = classify(candidates, thresholds);
  return resolveBorderline(classified, judge);
}

/** Weighted match score 0–100: required skills count double, partial counts half. */
export function computeScore(results) {
  let got = 0, total = 0;
  for (const r of results) {
    const w = IMPORTANCE_WEIGHT[r.importance] ?? 1;
    total += w;
    got += w * (STATUS_CREDIT[r.status] ?? 0);
  }
  return total ? Math.round((got / total) * 100) : 0;
}
