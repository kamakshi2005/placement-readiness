import mongoose from 'mongoose';

// Stores LLM / embedding results by a SHA-256 key, so the same input always gives the same
// output (temperature 0 alone does not guarantee that) and we save free-tier API calls.
// key = sha256(kind | model | prompt version | input). Changing the model or the prompt
// version gives a new key, so old cached answers are never reused by mistake.
const llmCacheSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true, enum: ['resume_skills', 'jd_skills', 'embedding', 'judge'] },
    model: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    // which model actually answered + the version it reported (absent on old entries)
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

export default mongoose.model('LlmCache', llmCacheSchema);
