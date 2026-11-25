// Turns a student's interviews + scored answers into weighted BKT evidence per skill.
// Pure function (the database loading and the embedding-based duplicate check are done by the
// caller), so every rule here is unit-tested.
//
// Rules (Phase 2 plan):
//  - skills are canonicalised with the Module 2 alias map ("Node", "NodeJS", "Node.js" -> node.js)
//  - not-reached answers are no evidence; HR questions test no technical skill -> skipped
//  - skipped answers count as score 0 at weight WEIGHTS.skipped
//  - a question testing k > 1 skills gives each skill WEIGHTS.multiSkillShare
//  - weight is multiplied by the answer's scoring confidence (0–1)
//  - a near-duplicate of a question the student had ALREADY SEEN (results viewed or model answer
//    opened, whichever was first) gets WEIGHTS.nearDuplicate — only compared with seen questions
//    that share a skill (calibration: different-skill pairs can be as similar as real repeats)
//  - learning (learnBefore) only between interviews: the previous interview that tested the skill
//    had its results viewed before this interview started
// ASSUMPTION: answers within one interview are independent evidence (documented in CLAUDE.md).
import { canonicalSkill } from '../skillNames.js';
import { PRIORS, WEIGHTS } from '../../config/mastery.js';

const time = (d) => (d ? new Date(d).getTime() : null);

/**
 * @param sessions  [{ _id, createdAt, resultsViewedAt, questions: [{ index, category, skills, text }] }]
 * @param answers   [{ session, questionIndex, status, score, scoreConfidence, shownAt, referenceShownAt, evaluation }]
 * @param isNearDuplicate (textA, textB) => boolean
 * @returns Map canonicalSkill -> { name, evidence: [{ score, weight, weightParts, session, learnBefore, … }] }
 */
export function buildEvidence({ sessions, answers, isNearDuplicate = () => false }) {
  const ordered = [...sessions].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const answersBySession = new Map();
  for (const a of answers) {
    const k = String(a.session);
    if (!answersBySession.has(k)) answersBySession.set(k, []);
    answersBySession.get(k).push(a);
  }

  const bySkill = new Map();
  const lastSessionOfSkill = new Map(); // skill -> the last session (object) that gave evidence
  const seen = []; // questions the student has seen the answers to: { text, seenAt }

  for (const s of ordered) {
    const sAnswers = (answersBySession.get(String(s._id)) || []).sort((a, b) => a.questionIndex - b.questionIndex);
    for (const a of sAnswers) {
      const q = s.questions.find((x) => x.index === a.questionIndex);
      if (!q || !a.evaluation || a.status === 'not_reached' || q.category === 'hr') continue;
      const skills = [...new Set((q.skills || []).map(canonicalSkill).filter(Boolean))];
      if (!skills.length) continue;

      const askedAt = time(a.shownAt) ?? time(s.createdAt);
      const repeat = seen.some((x) => x.seenAt < askedAt && x.skills.some((k) => skills.includes(k)) && isNearDuplicate(q.text, x.text));
      const parts = {
        confidence: a.scoreConfidence ?? 1,
        share: skills.length > 1 ? WEIGHTS.multiSkillShare : 1,
        skipped: a.status === 'skipped' ? WEIGHTS.skipped : 1,
        repeat: repeat ? WEIGHTS.nearDuplicate : 1,
      };
      const weight = parts.confidence * parts.share * parts.skipped * parts.repeat;
      const score = a.status === 'skipped' ? 0 : a.score ?? 0;

      for (const skill of skills) {
        if (!bySkill.has(skill)) bySkill.set(skill, { name: q.skills.find((n) => canonicalSkill(n) === skill) || skill, evidence: [] });
        const prev = lastSessionOfSkill.get(skill);
        const learnBefore =
          !!prev && String(prev._id) !== String(s._id) && !!prev.resultsViewedAt && time(prev.resultsViewedAt) < time(s.createdAt);
        bySkill.get(skill).evidence.push({
          answer: a._id,
          session: s._id,
          questionIndex: a.questionIndex,
          question: q.text,
          status: a.status,
          score,
          weight,
          weightParts: parts,
          learnBefore,
          at: a.shownAt || s.createdAt,
        });
        lastSessionOfSkill.set(skill, s);
      }
    }
    // after this interview, its questions count as "seen" from the first moment the student saw
    // feedback: the results page (which lists the key points) or an opened model answer
    for (const a of sAnswers) {
      const q = s.questions.find((x) => x.index === a.questionIndex);
      const candidates = [time(s.resultsViewedAt), time(a.referenceShownAt)].filter((t) => t != null);
      if (q && candidates.length) seen.push({ text: q.text, skills: (q.skills || []).map(canonicalSkill), seenAt: Math.min(...candidates) });
    }
  }
  return bySkill;
}

/**
 * Prior per skill from the MOST RECENT analysis that lists it (Module 2 match status).
 * @param analyses [{ createdAt, results: [{ jdSkill, canonical, status }] }]
 */
export function priorFor(skill, analyses) {
  const newestFirst = [...analyses].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  for (const an of newestFirst) {
    const r = (an.results || []).find((x) => canonicalSkill(x.canonical || x.jdSkill) === skill);
    if (r) return { prior: PRIORS[r.status] ?? PRIORS.unknown, source: r.status, analysis: an._id, name: r.jdSkill };
  }
  return { prior: PRIORS.unknown, source: 'unknown' };
}
