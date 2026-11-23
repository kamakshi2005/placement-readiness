// Re-scores a finished interview as a NEW evaluation version (old versions are kept).
// Use it after changing the scoring prompt/model, or to measure scoring consistency.
// Usage: npm run rescore -- <sessionId>
import 'dotenv/config';
import { defaultScriptMode } from '../src/services/llmRecorder.js';
import mongoose from 'mongoose';
import InterviewSession from '../src/models/InterviewSession.js';
import { scoreSession } from '../src/services/scoring/evaluateSession.js';

// AI calls: replay saved responses by default; real calls only with --live or --record
defaultScriptMode();

const [sessionId] = process.argv.slice(2);
if (!mongoose.isValidObjectId(sessionId)) {
  console.error('Usage: npm run rescore -- <sessionId>');
  process.exit(1);
}
await mongoose.connect(process.env.MONGO_URI);
const t = Date.now();
await scoreSession(sessionId, { rescore: true });
const s = await InterviewSession.findById(sessionId).select('scoring').lean();
console.log(`Scoring ${s?.scoring?.status} (${s?.scoring?.done}/${s?.scoring?.total}) in ${((Date.now() - t) / 1000).toFixed(0)}s${s?.scoring?.error ? ` — ${s.scoring.error}` : ''}`);
await mongoose.disconnect();
