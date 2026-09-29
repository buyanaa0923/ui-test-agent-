// Scoring of models against HUMAN labels on real findings. Pure functions: no I/O, no model calls, no tuning.
// Gates are passed in (they come from the same env vars the production cascade reads); nothing here fits them to the labels.
import { wilson } from './agreement.mjs';

// The production ladder for one finding: Jev settles it if confident enough (confirming needs less than dismissing),
// otherwise Claude; anything Claude cannot settle (needs_human / unjudged / unavailable) goes to a person.
export function cascadeDecision(jev, claudeVerdict, gates) {
  if (jev && jev.confidence >= (jev.pred ? gates.confirm : gates.dismiss)) return { verdict: jev.pred ? 'real' : 'false_positive', by: 'jev', escalatedToClaude: false, escalatedToHuman: false };
  if (claudeVerdict === 'real' || claudeVerdict === 'false_positive') return { verdict: claudeVerdict, by: 'claude', escalatedToClaude: true, escalatedToHuman: false };
  return { verdict: 'needs_human', by: 'human', escalatedToClaude: true, escalatedToHuman: true };
}

const prop = (k, n) => wilson(k, n);
const clusterWeighted = (rows, isRight) => {
  const by = new Map();
  for (const r of rows) { const a = by.get(r.cluster ?? r.id) || []; a.push(isRight(r) ? 1 : 0); by.set(r.cluster ?? r.id, a); }
  if (!by.size) return null;
  return [...by.values()].reduce((s, a) => s + a.reduce((x, y) => x + y, 0) / a.length, 0) / by.size;
};
const isDecided = (v) => v === 'real' || v === 'false_positive';

// rows: [{ id, positive (human label: real?), cluster, rule?, jev: {pred, confidence, p}|null, claude: {verdict}|null }]
export function scoreRealEval(rows, gates, { minNForClaim = 30, target = 0.9 } = {}) {
  if (!rows.length) return null;
  const all = rows;
  rows = all.filter((r) => r.modelEligible !== false); // rows the models were never asked about stay out of the model arms and the cascade
  const n = rows.length;
  const out = { n: all.length, nModelEligible: n, clusters: new Set(all.map((r) => r.cluster ?? r.id)).size, gates };

  const ruleRows = all.filter((r) => r.rule);
  if (ruleRows.length) {
    const by = {};
    for (const r of ruleRows) { by[r.rule] ||= { k: 0, n: 0 }; by[r.rule].n++; if (r.positive) by[r.rule].k++; }
    out.rules = { overall: prop(ruleRows.filter((r) => r.positive).length, ruleRows.length), byRule: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, prop(v.k, v.n)])) };
  }

  const jr = rows.filter((r) => r.jev);
  if (jr.length) {
    const settled = jr.filter((r) => r.jev.confidence >= (r.jev.pred ? gates.confirm : gates.dismiss));
    out.jev = {
      accuracy: prop(jr.filter((r) => r.jev.pred === r.positive).length, jr.length),
      clusterWeightedAccuracy: clusterWeighted(jr, (r) => r.jev.pred === r.positive),
      atGate: { settled: settled.length, coverage: settled.length / jr.length, accuracyOnSettled: settled.length ? prop(settled.filter((r) => r.jev.pred === r.positive).length, settled.length) : null }
    };
  }

  const cr = rows.filter((r) => r.claude);
  if (cr.length) {
    const decided = cr.filter((r) => isDecided(r.claude.verdict));
    const right = (r) => (r.claude.verdict === 'real') === r.positive;
    out.claude = {
      accuracy: decided.length ? prop(decided.filter(right).length, decided.length) : null,
      strictAccuracy: prop(decided.filter(right).length, cr.length),
      undecided: cr.length - decided.length,
      clusterWeightedAccuracy: clusterWeighted(decided, right)
    };
  }

  const decisions = rows.map((r) => ({ r, d: cascadeDecision(r.jev, r.claude?.verdict, gates) }));
  const auto = decisions.filter((x) => !x.d.escalatedToHuman);
  const okAuto = auto.filter((x) => (x.d.verdict === 'real') === x.r.positive);
  out.cascade = {
    decided: auto.length,
    accuracyOnDecided: auto.length ? prop(okAuto.length, auto.length) : null,
    strictAccuracy: prop(okAuto.length, n),
    clusterWeightedAccuracy: clusterWeighted(auto.map((x) => x.r), (r) => (decisions.find((y) => y.r === r).d.verdict === 'real') === r.positive),
    settledByJev: decisions.filter((x) => x.d.by === 'jev').length,
    escalatedToClaude: decisions.filter((x) => x.d.escalatedToClaude).length,
    escalatedToHuman: decisions.filter((x) => x.d.escalatedToHuman).length,
    decisions: decisions.map((x) => ({ id: x.r.id, truth: x.r.positive ? 'real' : 'false_positive', ...x.d }))
  };

  const acc = out.cascade.accuracyOnDecided;
  out.target = { goal: target, minNForClaim, basis: 'cascade accuracy on the findings it decided', point: acc ? acc.p : null, status: !acc || n < minNForClaim ? 'preliminary' : acc.p >= target ? 'met' : 'not_met' };
  return out;
}
