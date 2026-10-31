// Canonical form of free text before it is hashed (cache key), sent to the LLM or stored.
// Browsers submit textarea content with Windows line endings (\r\n), curl/Mac/Linux with \n —
// without this, the same JD would get a different hash and miss the cache.
export function normalizeText(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n') // CRLF / CR -> LF
    .replace(/[ \t ]+/g, ' ') // non-breaking spaces, tabs, repeated spaces -> one space
    .replace(/ *\n */g, '\n') // no spaces around line breaks
    .replace(/\n{3,}/g, '\n\n') // at most one blank line
    .trim();
}
