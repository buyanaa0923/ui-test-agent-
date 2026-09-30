// Model output is untrusted text. Validate the shape before anything downstream uses it.
const isStr = (v) => typeof v === 'string';
export const VERDICTS = ['real', 'false_positive', 'needs_human'];
export const SEVERITIES = ['high', 'medium', 'low'];

export function parseJson(text, kind = 'array') {
  const m = text.match(kind === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON ${kind} in model output`);
  try { return JSON.parse(m[0]); } catch { throw new Error(`invalid JSON ${kind} in model output`); }
}

// Returns {ok, value|errors}. Bad entries are dropped individually so one malformed row does not discard the batch.
export function validateVerdicts(arr, knownKeys) {
  if (!Array.isArray(arr)) return { ok: false, errors: ['not an array'] };
  const errors = [], value = [];
  for (const v of arr) {
    if (!v || !isStr(v.key) || !knownKeys.has(v.key)) { errors.push(`unknown key ${JSON.stringify(v?.key)}`); continue; } // cannot invent findings
    if (!VERDICTS.includes(v.verdict)) { errors.push(`${v.key}: bad verdict ${JSON.stringify(v.verdict)}`); continue; }
    value.push({
      key: v.key, verdict: v.verdict,
      severity: SEVERITIES.includes(v.severity) ? v.severity : undefined,
      reason: isStr(v.reason) ? v.reason.slice(0, 200) : '', fix: isStr(v.fix) ? v.fix.slice(0, 200) : ''
    });
  }
  return { ok: value.length > 0 || arr.length === 0, value, errors };
}

export function validatePick(o, nCandidates) {
  const ok = o && Number.isInteger(o.choice) && o.choice >= -1 && o.choice < nCandidates && typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1;
  return ok ? { ok: true, value: { choice: o.choice, confidence: o.confidence } } : { ok: false, errors: [`bad pick ${JSON.stringify(o)}`] };
}
