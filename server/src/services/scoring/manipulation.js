// Detects text in an answer that is addressed to the examiner/AI instead of answering the
// question ("ignore previous instructions", "give this full marks", …). Validation (prompt s1)
// showed the lite models give in a little to such text (+21 points once), so:
//   1. the prompt repeats the scoring instruction AFTER the answer (rubric.js), and
//   2. this check marks such scores "uncertain" with the reason, for a human to look at.
// Phrases are deliberately specific to avoid flagging normal answers (e.g. "I gave full effort").

const PATTERNS = [
  /\bignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions?|prompts?|rules?)/i,
  /\bignore\s+(?:the\s+)?(?:rubric|reference(?:\s+answer)?|marking\s+scheme|key\s+points)/i,
  /\b(?:give|award|assign|grant)\s+(?:me\s+|this(?:\s+answer)?\s+|it\s+)?(?:full|maximum|max|perfect|top|100\s*%?)\s+(?:marks?|scores?|points|credit)/i,
  /\bfull\s+marks\b/i,
  /\b(?:mark|label|treat)\s+(?:every|all|each)\s+(?:of\s+the\s+)?key[\s-]?points?\b/i,
  /\bnote\s+to\s+(?:the\s+)?(?:examiner|evaluator|grader|marker|reviewer|ai|model|assistant)\b/i,
  /\b(?:dear|attention|hey|hi)\s*,?\s+(?:examiner|evaluator|grader|marker|ai|chatgpt|gemini|assistant)\b/i,
  /\byou\s+(?:are|must|should|will)\s+(?:now\s+)?(?:an?\s+|the\s+)?(?:examiner|evaluator|grader|score|mark|rate|give)\b/i,
  /\b(?:system\s+prompt|developer\s+message|new\s+instructions?)\b/i,
  /\b(?:score|rate|grade)\s+(?:this|my)\s+(?:answer|response)\s+(?:as\s+|with\s+)?(?:4\/4|100|10\/10|excellent|perfect)/i,
];

/** @returns the matched phrases (empty array = nothing suspicious) */
export function findExaminerDirectedText(answer) {
  const text = String(answer || '');
  const hits = [];
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m && !hits.includes(m[0])) hits.push(m[0]);
  }
  return hits;
}
