// Removes personal details from resume text BEFORE it is sent to the LLM or stored.
// Regex-based, so it is best-effort: unusual formats can slip through (see Limitations).

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// http(s)://..., www...., and bare profile links like github.com/user or linkedin.com/in/user
const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|in|io|dev|me|org|net|app|co)\/\S*/gi;

// Phone numbers: optional +country code, then 10+ digits possibly split by spaces, dashes, dots
// or brackets. Requiring 10+ digits avoids hitting years ("2021-2024") or CGPA ("8.5").
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d[\d\s().-]{8,}\d)/g;

function countDigits(s) {
  return (s.match(/\d/g) || []).length;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} text  raw resume text
 * @param {{ name?: string }} opts  the logged-in user's name, also removed
 * @returns {{ text: string, counts: { emails: number, urls: number, phones: number, names: number } }}
 */
export function redactPII(text, { name } = {}) {
  const counts = { emails: 0, urls: 0, phones: 0, names: 0 };
  let out = text;

  // Emails first, so the URL pattern doesn't eat half an email address
  out = out.replace(EMAIL_RE, () => (counts.emails++, '[EMAIL]'));
  out = out.replace(URL_RE, () => (counts.urls++, '[URL]'));
  out = out.replace(PHONE_RE, (m) => {
    if (countDigits(m) < 10 || countDigits(m) > 13) return m; // not a phone number
    counts.phones++;
    return '[PHONE]';
  });

  // Full name, then each part of the name with 3+ letters (e.g. "Kamakshi", "Sharma").
  // Very short parts like initials ("S") are skipped — too likely to hit normal words.
  if (name && name.trim()) {
    const parts = [name.trim(), ...name.trim().split(/\s+/).filter((p) => p.length >= 3)];
    for (const part of parts) {
      const re = new RegExp(`\\b${escapeRegex(part)}\\b`, 'gi');
      out = out.replace(re, () => (counts.names++, '[NAME]'));
    }
  }

  return { text: out, counts };
}
