// Scoring for yes/no decisions with confidence. rec = {positive (truth), pred, confidence, ms, costUsd, lang?}
export const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : +v.toFixed(d));
const safe = (a, b) => (b ? a / b : 0);

export function scoreBinary(recs) {
  const tp = recs.filter((r) => r.positive && r.pred).length, fp = recs.filter((r) => !r.positive && r.pred).length;
  const fn = recs.filter((r) => r.positive && !r.pred).length, tn = recs.filter((r) => !r.positive && !r.pred).length;
  const precision = safe(tp, tp + fp), recall = safe(tp, tp + fn);
  return { n: recs.length, tp, fp, fn, tn, accuracy: round(safe(tp + tn, recs.length)), precision: round(precision), recall: round(recall), f1: round(safe(2 * precision * recall, precision + recall)) };
}

// Expected calibration error: does "90% confident" mean right 90% of the time?
export function ece(recs, bins = 10) {
  let total = 0;
  const rows = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inBin = recs.filter((r) => r.confidence >= lo && (b === bins - 1 ? r.confidence <= hi : r.confidence < hi));
    if (!inBin.length) continue;
    const acc = safe(inBin.filter((r) => r.pred === r.positive).length, inBin.length), conf = safe(inBin.reduce((s, r) => s + r.confidence, 0), inBin.length);
    total += (inBin.length / recs.length) * Math.abs(acc - conf);
    rows.push({ bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`, n: inBin.length, confidence: round(conf, 3), accuracy: round(acc, 3) });
  }
  return { ece: round(total), bins: rows };
}

// "Jev alone answers X% of decisions at Y% accuracy; the rest escalate."
export function coverage(recs, gates = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
  return gates.map((g) => {
    const cov = recs.filter((r) => r.confidence >= g);
    return { gate: g, coverage: round(safe(cov.length, recs.length)), accuracy: round(safe(cov.filter((r) => r.pred === r.positive).length, cov.length)), escalated: recs.length - cov.length };
  });
}

export const pct = (arr, q) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
export const latency = (recs) => { const m = recs.map((r) => r.ms).filter((x) => x != null); return { p50: pct(m, 0.5), p95: pct(m, 0.95), mean: m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null }; };
export const costOf = (recs) => round(recs.reduce((s, r) => s + (r.costUsd ?? 0), 0), 6);
