// Evidence spans: find the AI's quotes inside the student's answer and turn them into
// character positions (start, end), so the client can highlight exactly that text.
// A quote that cannot be found is DROPPED (and counted) — the AI never gets to "invent" evidence.
import { FUZZY_MIN_OVERLAP, FUZZY_MIN_WORDS } from '../../config/scoring.js';

// Characters that differ between how students type and how the AI copies text
const CHAR_MAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', ' ': ' ' };

/**
 * Lowercase, unify quotes/dashes, collapse whitespace — and remember, for every character of
 * the normalized text, which character of the original it came from (so we can map back).
 */
function normalizeWithMap(s) {
  let out = '';
  const map = [];
  let lastWasSpace = true; // also trims leading space
  for (let i = 0; i < s.length; i++) {
    let c = CHAR_MAP[s[i]] ?? s[i];
    if (/\s/.test(c)) {
      if (lastWasSpace) continue;
      c = ' ';
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    out += c.toLowerCase();
    map.push(i);
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    map.pop();
  }
  return { text: out, map };
}

/** Words with their character positions in the original text */
function words(s) {
  return [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length }));
}

/**
 * Fuzzy match: slide a window of the quote's length (±1 word) over the answer's words and
 * keep the window with the highest word overlap. Accept only if overlap >= FUZZY_MIN_OVERLAP.
 */
function fuzzyFind(answer, quote) {
  const q = words(quote);
  if (q.length < FUZZY_MIN_WORDS) return null;
  const a = words(answer);
  let best = null;
  for (const len of [q.length, q.length - 1, q.length + 1]) {
    if (len < 1 || len > a.length) continue;
    for (let i = 0; i + len <= a.length; i++) {
      // multiset overlap between quote words and window words
      const counts = new Map();
      for (const { w } of q) counts.set(w, (counts.get(w) || 0) + 1);
      let hits = 0;
      for (let j = i; j < i + len; j++) {
        const c = counts.get(a[j].w);
        if (c) {
          hits++;
          counts.set(a[j].w, c - 1);
        }
      }
      const overlap = hits / Math.max(q.length, len);
      if (!best || overlap > best.overlap) best = { overlap, start: a[i].start, end: a[i + len - 1].end };
    }
  }
  return best && best.overlap >= FUZZY_MIN_OVERLAP ? best : null;
}

/**
 * Locate `quote` in `answer`.
 * @returns {{start, end, text, matchType: 'exact'|'normalized'|'fuzzy'} | null}
 */
export function findQuote(answer, quote) {
  const qt = String(quote ?? '').trim();
  if (!qt || !answer) return null;

  const i = answer.indexOf(qt);
  if (i >= 0) return { start: i, end: i + qt.length, text: qt, matchType: 'exact' };

  const A = normalizeWithMap(answer);
  const Q = normalizeWithMap(qt);
  const j = Q.text ? A.text.indexOf(Q.text) : -1;
  if (j >= 0) {
    const start = A.map[j];
    const end = A.map[j + Q.text.length - 1] + 1;
    return { start, end, text: answer.slice(start, end), matchType: 'normalized' };
  }

  const f = fuzzyFind(answer, qt);
  return f ? { start: f.start, end: f.end, text: answer.slice(f.start, f.end), matchType: 'fuzzy' } : null;
}

export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** Merge overlapping or touching spans into one (sorted by start). */
export function mergeSpans(spans, answer) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      // keep the weakest match type for honesty (fuzzy < normalized < exact)
      const rank = { fuzzy: 0, normalized: 1, exact: 2 };
      if (rank[s.matchType] < rank[last.matchType]) last.matchType = s.matchType;
    } else {
      out.push({ ...s });
    }
  }
  return out.map((s) => ({ ...s, text: answer.slice(s.start, s.end) }));
}
