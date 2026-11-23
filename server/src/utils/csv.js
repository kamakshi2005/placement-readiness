// Minimal RFC 4180 CSV writer/reader — enough for the hand-labelling sheets, which are edited
// in Excel / Google Sheets (quotes, commas and line breaks inside answers must survive).

const BOM = '﻿'; // makes Excel open the file as UTF-8 (otherwise “quotes” and ₹ break)

function cell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: array of objects; columns: array of keys (also the header) */
export function toCSV(rows, columns) {
  return BOM + [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

/** Parse CSV text into an array of objects keyed by the header row */
export function parseCSV(text) {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
