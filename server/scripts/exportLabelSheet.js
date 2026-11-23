// Exports real, AI-scored answers into two CSV sheets for hand-labelling (Phase 1 validation).
//
// Usage (from server/):
//   npm run eval:label-sheet                     the 20 most recent AI-scored answers
//   npm run eval:label-sheet -- --limit 30
//
// Writes eval/human/sheet-<stamp>-answers.csv and sheet-<stamp>-keypoints.csv.
// Fill the human_* columns in Excel / Google Sheets (keep the files as CSV), then run
//   npm run eval:human -- eval/human/sheet-<stamp>-answers.csv eval/human/sheet-<stamp>-keypoints.csv
// The model's own labels are in the sheet for reference — try to decide before looking at them.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import Answer from '../src/models/Answer.js';
import AnswerEvaluation from '../src/models/AnswerEvaluation.js';
import InterviewSession from '../src/models/InterviewSession.js';
import { toCSV } from '../src/utils/csv.js';

const args = process.argv.slice(2);
const i = args.indexOf('--limit');
const LIMIT = i >= 0 ? Number(args[i + 1]) : 20;

await mongoose.connect(process.env.MONGO_URI);

const evals = await AnswerEvaluation.find({ method: 'llm' }).sort({ createdAt: -1 }).limit(LIMIT * 3).lean();
// only the LATEST evaluation version of each answer
const latest = new Map();
for (const e of evals) if (!latest.has(String(e.answer))) latest.set(String(e.answer), e);
const chosen = [...latest.values()].slice(0, LIMIT);
if (!chosen.length) {
  console.log('No AI-scored answers yet. Complete an interview first.');
  process.exit(0);
}

const answers = new Map((await Answer.find({ _id: { $in: chosen.map((e) => e.answer) } }).lean()).map((a) => [String(a._id), a]));
const sessions = new Map(
  (await InterviewSession.find({ _id: { $in: chosen.map((e) => e.session) } }).select('+questions.reference').lean()).map((s) => [String(s._id), s])
);

const answerRows = [];
const kpRows = [];
for (const e of chosen) {
  const a = answers.get(String(e.answer));
  const q = sessions.get(String(e.session))?.questions?.[e.questionIndex];
  if (!a || !q) continue;
  answerRows.push({
    evaluation_id: String(e._id),
    category: q.category,
    difficulty: q.difficulty,
    skills: q.skills.join('; '),
    question: q.text,
    reference_answer: q.reference?.answer,
    student_answer: a.text,
    timed_out: e.timedOut ? 'yes' : 'no',
    model_score: e.score,
    model_range: `${e.scoreMin}-${e.scoreMax}`,
    model_uncertain: e.uncertain ? 'yes' : 'no',
    model_correctness: e.dimensions?.correctness?.value,
    model_depth: e.dimensions?.depth?.value,
    model_clarity: e.dimensions?.clarity?.value,
    model_errors: (e.errorSpans || []).filter((x) => x.accepted).map((x) => `"${x.text}" — ${x.explanation}`).join(' | '),
    human_correctness: '',
    human_depth: '',
    human_clarity: '',
    human_reference_correct: '',
    notes: '',
  });
  for (const k of e.keyPoints) {
    kpRows.push({
      evaluation_id: String(e._id),
      kp_id: k.id,
      key_point: k.text,
      model_label: k.label,
      human_label: '',
      human_kp_correct: '',
    });
  }
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'human');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const fa = path.join(dir, `sheet-${stamp}-answers.csv`);
const fk = path.join(dir, `sheet-${stamp}-keypoints.csv`);
fs.writeFileSync(fa, toCSV(answerRows, Object.keys(answerRows[0])));
fs.writeFileSync(fk, toCSV(kpRows, Object.keys(kpRows[0])));

console.log(`Wrote ${answerRows.length} answers and ${kpRows.length} key points:
  ${path.relative(process.cwd(), fa)}
  ${path.relative(process.cwd(), fk)}

Fill in:
  answers sheet:   human_correctness, human_depth, human_clarity  (0-4, same rubric as the app)
                   human_reference_correct  (yes / partly / no — is the MODEL answer itself right?)
  keypoints sheet: human_label       (covered / partial / missing)
                   human_kp_correct  (yes / no — is this key point itself correct and relevant?)
Then: npm run eval:human -- "${path.relative(process.cwd(), fa)}" "${path.relative(process.cwd(), fk)}"`);

await mongoose.disconnect();
