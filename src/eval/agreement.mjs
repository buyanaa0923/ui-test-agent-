// Inter-labeller agreement, confidence intervals, CSV, and merging two engineers' independent labels.
// No model is involved anywhere in this file: it turns human judgements into a labelled set and says how far they agree.

export const LABELS = ['real', 'false_positive', 'unsure'];

// Cohen's kappa for two raters over pairs [a, b]. Null (not NaN, not 1) when it is undefined: no pairs, or chance agreement is total.
export function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, observed: null, expected: null, kappa: null };
  const cats = [...new Set(pairs.flat())];
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  let expected = 0;
  for (const c of cats) expected += (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n);
  const kappa = expected >= 1 ? null : (observed - expected) / (1 - expected);
  return { n, observed, expected, kappa };
}

export function interpretKappa(k) {
  if (k == null) return 'undefined';
  return k < 0 ? 'worse than chance' : k < 0.2 ? 'slight' : k < 0.4 ? 'fair' : k < 0.6 ? 'moderate' : k < 0.8 ? 'substantial' : 'almost perfect';
}

// Wilson score interval for a proportion k/n (z = 1.96, 95%). Honest about small n.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), n, k };
}

// ---- CSV (RFC 4180 subset: quotes, commas, newlines inside quotes, CRLF) ----
export function toCsv(rows, columns) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ''));
  if (!nonEmpty.length) return [];
  const [head, ...body] = nonEmpty;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// Two engineers labelled independently (A, B); disagreements and "unsure" go to a third person (adj).
// Agreement is accepted as is; adjudication only ever settles what A and B did not settle. Nothing is guessed.
export function mergeLabels(records, A, B, adj = []) {
  const norm = (rows, who) => {
    const m = new Map();
    for (const r of rows) {
      const l = (r.label || '').trim().toLowerCase();
      if (!l) continue;
      if (!LABELS.includes(l)) throw new Error(`invalid label "${r.label}" for ${r.id} in ${who} (use real, false_positive or unsure)`);
      m.set(r.id, l);
    }
    return m;
  };
  const a = norm(A, 'labeller A'), b = norm(B, 'labeller B'), j = norm(adj, 'adjudication');
  const final = {}, needsAdjudication = [], unlabeled = [], pairs = [];
  for (const rec of records) {
    const la = a.get(rec.id), lb = b.get(rec.id);
    if (!la || !lb) { unlabeled.push(rec.id); continue; }
    if (la !== 'unsure' && lb !== 'unsure') pairs.push([la, lb]);
    if (la === lb && la !== 'unsure') final[rec.id] = la;
    else if (j.has(rec.id) && j.get(rec.id) !== 'unsure') final[rec.id] = j.get(rec.id);
    else needsAdjudication.push(rec.id);
  }
  const unsureCount = records.filter((r) => a.get(r.id) === 'unsure' || b.get(r.id) === 'unsure').length;
  return { final, needsAdjudication, unlabeled, unsureCount, kappa: { ...cohenKappa(pairs), interpretation: interpretKappa(cohenKappa(pairs).kappa) } };
}
