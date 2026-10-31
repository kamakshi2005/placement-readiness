// Creates one evaluation pair file from a resume PDF + a JD text file.
// Usage:
//   npm run eval:prepare -- <resume.pdf> <jd.txt> <pairId> <tune|holdout> ["Student Name"]
// Writes eval/pairs/<pairId>.json with extracted skills and label "TODO" for every JD skill.
// You then replace each TODO with present / partial / absent (YOUR judgement, from the resume).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { pdfToText } from '../src/services/pdf.js';
import { redactPII } from '../src/services/redact.js';
import { extractResumeSkills, extractJdSkills, PROMPT_VERSION } from '../src/services/skills.js';
import { dedupeSkills } from '../src/services/matcher.js';
import { modelInfo } from '../src/services/llm.js';
import { normalizeText } from '../src/utils/normalizeText.js';

const [pdfPath, jdPath, pairId, split, studentName] = process.argv.slice(2);
if (!pdfPath || !jdPath || !pairId || !['tune', 'holdout'].includes(split)) {
  console.error('Usage: npm run eval:prepare -- <resume.pdf> <jd.txt> <pairId> <tune|holdout> ["Student Name"]');
  process.exit(1);
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'pairs');
const outFile = path.join(outDir, `${pairId}.json`);
if (fs.existsSync(outFile)) {
  console.error(`${outFile} already exists — delete it first if you really want to recreate it (your labels would be lost).`);
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI); // for the LLM cache

const raw = await pdfToText(fs.readFileSync(pdfPath));
const { text: resumeText, counts } = redactPII(raw, { name: studentName });
const jdText = normalizeText(fs.readFileSync(jdPath, 'utf8'));

console.log(`Redacted: ${JSON.stringify(counts)}. Extracting skills (can take a minute on the free tier)…`);
const [resume, jd] = await Promise.all([extractResumeSkills(resumeText), extractJdSkills(jdText)]);
const { jd: jdSkills, resume: resumeSkills } = dedupeSkills(jd.skills, resume.skills);

const pair = {
  id: pairId,
  split,
  notes: 'Describe the role/resume briefly. Do NOT write the student\'s name here.',
  extractedWith: { genModel: modelInfo().genModel, promptVersion: PROMPT_VERSION },
  resumeSkills: resumeSkills.map((s) => s.name),
  jdSkills: jdSkills.map((s) => ({ name: s.name, importance: s.importance, label: 'TODO' })),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(pair, null, 2) + '\n');
console.log(`✅ Wrote ${outFile}`);
console.log(`   ${pair.resumeSkills.length} resume skills, ${pair.jdSkills.length} JD skills — now set every "label".`);

await mongoose.disconnect();
