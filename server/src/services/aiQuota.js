// Free-tier quota handling: daily usage counter (stored in MongoDB) + per-model pacing
// (requests per minute and calls in flight), so we stay under Google's limits.
import mongoose from 'mongoose';
import ModelUsage from '../models/ModelUsage.js';
import { limitsFor, QUOTA_TIMEZONE, DAILY_RESERVE } from '../config/models.js';

// ---------------- quota day ----------------

/** 'YYYY-MM-DD' of the current quota day (Pacific time) */
export function dayKey(date = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Milliseconds until the next quota reset (midnight Pacific) */
export function msUntilReset(now = new Date()) {
  const today = dayKey(now);
  // step forward in 10-minute increments until the Pacific date changes (DST-safe, ≤ 145 steps)
  let t = now.getTime();
  while (dayKey(new Date(t)) === today) t += 10 * 60 * 1000;
  // refine to the minute
  t -= 10 * 60 * 1000;
  while (dayKey(new Date(t)) === today) t += 60 * 1000;
  return t - now.getTime();
}

export function resetInWords(now = new Date()) {
  const min = Math.ceil(msUntilReset(now) / 60000);
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

// ---------------- daily usage counter ----------------
// Without a database connection (unit tests, replay mode) the counter is simply skipped.
const dbReady = () => mongoose.connection.readyState === 1;

export async function usageToday(model) {
  if (!dbReady()) return { count: 0, exhausted: false };
  const doc = await ModelUsage.findOne({ model, day: dayKey() }).lean();
  return { count: doc?.count || 0, exhausted: !!doc?.exhausted };
}

/** Requests still available today (0 if Google said the quota is used up) */
export async function remainingToday(model) {
  const { count, exhausted } = await usageToday(model);
  return exhausted ? 0 : Math.max(0, limitsFor(model).rpd - count);
}

export async function countRequest(model) {
  if (!dbReady()) return;
  await ModelUsage.updateOne({ model, day: dayKey() }, { $inc: { count: 1 } }, { upsert: true });
}

export async function markExhausted(model) {
  if (!dbReady()) return;
  await ModelUsage.updateOne({ model, day: dayKey() }, { $set: { exhausted: true } }, { upsert: true });
}

/**
 * Can a job that needs `need` = { model: requests } run today, keeping DAILY_RESERVE spare?
 * @returns { ok, short: [{ model, need, remaining }] }
 */
export async function canAfford(need) {
  const short = [];
  for (const [model, n] of Object.entries(need)) {
    if (!n) continue;
    const remaining = await remainingToday(model);
    if (remaining - DAILY_RESERVE < n) short.push({ model, need: n, remaining });
  }
  return { ok: short.length === 0, short };
}

/** Today's usage of every configured model (for the admin page) */
export async function usageReport(models) {
  return Promise.all(
    models.map(async (model) => {
      const { count, exhausted } = await usageToday(model);
      const { rpd, rpm } = limitsFor(model);
      return { model, used: count, limit: rpd, rpm, exhausted, remaining: exhausted ? 0 : Math.max(0, rpd - count) };
    })
  );
}

// ---------------- pacing (per process) ----------------
// At most `concurrency` calls in flight and at most `rpm` call starts per rolling minute.
const pace = new Map(); // model -> { active, starts: [timestamps] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function acquireSlot(model) {
  const { rpm, concurrency } = limitsFor(model);
  if (!pace.has(model)) pace.set(model, { active: 0, starts: [] });
  const p = pace.get(model);
  for (;;) {
    const now = Date.now();
    while (p.starts.length && now - p.starts[0] >= 60000) p.starts.shift();
    if (p.active < concurrency && p.starts.length < rpm) {
      p.active++;
      p.starts.push(now);
      return () => {
        p.active--;
      };
    }
    // wait for a running call to finish, or for the oldest start to leave the 1-minute window
    await sleep(p.active >= concurrency ? 200 : Math.max(200, p.starts[0] + 60000 - now));
  }
}
