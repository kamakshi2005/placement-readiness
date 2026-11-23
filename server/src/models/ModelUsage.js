import mongoose from 'mongoose';

// How many requests we sent to each AI model on each quota day (Pacific time, like Google's reset).
// Lets the server warn before a model's daily free-tier limit runs out, instead of failing mid-job.
const modelUsageSchema = new mongoose.Schema(
  {
    model: { type: String, required: true },
    day: { type: String, required: true }, // 'YYYY-MM-DD' in America/Los_Angeles
    count: { type: Number, default: 0 },
    // set when Google itself says the daily quota is used up (our count may lag, e.g. calls
    // made from another machine or AI Studio with the same key)
    exhausted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
modelUsageSchema.index({ model: 1, day: 1 }, { unique: true });

export default mongoose.model('ModelUsage', modelUsageSchema);
