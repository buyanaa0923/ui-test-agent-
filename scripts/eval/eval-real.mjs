// Held-out evaluation on REAL findings labelled by people: Jev, Claude and the production cascade against the human labels.
// Usage: node scripts/eval/eval-real.mjs [--labels eval/real-findings.labeled.jsonl] [--replay]
//   live run : calls Jev and Claude, records every response in eval/cache/ (same cache as eval:jev)
//   --replay : scores from the cache only - no network, no cost, same numbers
// Gates are NOT options here: they come from GATE_CONFIRM / GATE_DISMISS exactly as in production (defaults 0.8 / 0.9).
// Nothing in this script adjusts anything based on the labels. It reads them and reports.
import fs from 'node:fs';
import path from 'node:path';
import { triageFinding } from '../../src/models/jev.mjs';
import { judge, viaApiForEval } from '../../src/models/judge.mjs';
import { fileCache } from '../../src/core/cache.mjs';
import { Meter } from '../../src/core/meter.mjs';
import { stamp } from '../../src/core/stamp.mjs';
import { scoreRealEval } from '../../src/eval/real-eval.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const replay = args.includes('--replay');
const root = ROOT;
const labelsFile = path.resolve(opt('labels', path.join(root, 'eval/real-findings.labeled.jsonl')));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const gates = { confirm: num(process.env.GATE_CONFIRM, 0.8), dismiss: num(process.env.GATE_DISMISS, 0.9) };

if (!fs.existsSync(labelsFile)) {
  console.error(`No labelled set at ${path.relative(root, labelsFile)}.\nThis evaluation needs labels from two engineers first:\n  1. npm run real:collect            (makes the sheet)\n  2. each engineer labels alone in review/real-findings/sheet.html and downloads a CSV\n  3. npm run real:labels -- --a <csv> --b <csv>   (agreement + final labels)\nNo numbers are produced without human labels.`);
  process.exit(2);
}
const records = fs.readFileSync(labelsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.label === 'real' || r.label === 'false_positive');
if (!records.length) { console.error('The labelled file has no usable labels (real / false_positive). Nothing to evaluate.'); process.exit(2); }

const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing.json'), 'utf8'));
const runDir = path.join(root, 'runs', `eval-real-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(runDir, { recursive: true });
const meter = new Meter({ runDir, pricing, maxUsd: Number(process.env.BUDGET_USD || 2) });
const cacheRoot = process.env.EVAL_CACHE_DIR || path.join(root, 'eval/cache');
const jevCache = fileCache(path.join(cacheRoot, 'jev'), { replayOnly: replay });
const claudeCache = fileCache(path.join(cacheRoot, 'claude'), { replayOnly: replay });
const cachedSend = (send) => async (prompt) => {
  const hit = claudeCache.get({ prompt });
  if (hit) return hit;
  if (replay) throw new Error('replay mode: no recorded Claude response');
  const r = await send(prompt); claudeCache.put({ prompt }, r); return r;
};
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k]); } })); return out; };

// Models judge design-rule findings (that is what the production triage prompts are written for). Flow findings are labelled and
// counted in rule precision, but not sent to the design triage models.
const design = records.filter((r) => r.source?.kind !== 'flow');
const rows = records.map((r) => ({ id: r.id, positive: r.label === 'real', cluster: r.source?.cluster || r.id, rule: r.finding.rule, kind: r.source?.kind || 'design', modelEligible: r.source?.kind !== 'flow', jev: null, claude: null }));
const byId = new Map(rows.map((r) => [r.id, r]));
const failures = [];

let h = meter.start('jev-real', { n: design.length });
const jevUsage = { model: 'jev-1.13', inputTokens: 0, outputTokens: 0 };
await pool(design, 4, async (r) => {
  try {
    meter.assertBudget();
    const j = await triageFinding(r.finding, { cache: jevCache });
    byId.get(r.id).jev = { pred: j.real, confidence: j.confidence, p: j.p };
    jevUsage.inputTokens += j.usage.inputTokens; jevUsage.outputTokens += j.usage.outputTokens;
  } catch (e) { failures.push({ id: r.id, model: 'jev', error: e.message }); }
});
meter.end(h, jevUsage);

h = meter.start('claude-real', { n: design.length });
for (let i = 0; i < design.length; i += 8) {
  const chunk = design.slice(i, i + 8);
  try {
    const j = await judge(chunk.map((c) => c.finding), { meter, send: cachedSend(viaApiForEval.judge) });
    chunk.forEach((c, k) => { byId.get(c.id).claude = { verdict: j[k].verdict }; });
  } catch (e) { chunk.forEach((c) => failures.push({ id: c.id, model: 'claude', error: e.message })); }
}
meter.end(h);

const modelRows = rows; // rows without a model answer stay null: the cascade sends those to a person (fail-safe), they are not dropped
const score = scoreRealEval(modelRows, gates);
const pct = (w) => (w ? `${(w.p * 100).toFixed(1)}% (${w.k}/${w.n}, 95% CI ${(w.lo * 100).toFixed(0)}-${(w.hi * 100).toFixed(0)}%)` : 'n/a');
console.log(`\nHeld-out evaluation on real findings labelled by people (${replay ? 'replay' : 'live'})`);
console.log(`  labelled findings: ${score.n} (${score.nModelEligible} design findings sent to the models, ${score.n - score.nModelEligible} flow findings labelled only)   distinct root-cause clusters: ${score.clusters}`);
console.log(`  gates (production, not tuned): confirm ${gates.confirm}, dismiss ${gates.dismiss}`);
if (score.rules) { console.log(`  L0 deterministic rules, precision on real pages: ${pct(score.rules.overall)}`); for (const [k, v] of Object.entries(score.rules.byRule)) console.log(`      ${k.padEnd(28)} ${pct(v)}`); console.log('      (recall on real pages is NOT measured here: a rule that misses a defect never produces a finding to label; the mutation benchmark measures recall on seeded defects only)'); }
if (score.jev) console.log(`  L1 Jev alone            accuracy ${pct(score.jev.accuracy)}; settles ${(score.jev.atGate.coverage * 100).toFixed(0)}% at the gates${score.jev.atGate.accuracyOnSettled ? `, right on ${pct(score.jev.atGate.accuracyOnSettled)} of those` : ''}; cluster-weighted ${(score.jev.clusterWeightedAccuracy * 100).toFixed(1)}%`);
if (score.claude) console.log(`  L2 Claude alone         accuracy ${pct(score.claude.accuracy)}; undecided (needs_human/unjudged) ${score.claude.undecided}; strict ${pct(score.claude.strictAccuracy)}`);
const c = score.cascade;
console.log(`  Cascade (Jev -> Claude -> person): settled by Jev ${c.settledByJev}, asked Claude ${c.escalatedToClaude}, sent to a person ${c.escalatedToHuman}`);
console.log(`      accuracy on what it decided ${pct(c.accuracyOnDecided)}${c.clusterWeightedAccuracy != null ? `; cluster-weighted ${(c.clusterWeightedAccuracy * 100).toFixed(1)}%` : ''}`);
console.log(`      strict (a finding sent to a person counts as a miss) ${pct(c.strictAccuracy)}`);
const t = score.target;
console.log(`  Target ${(t.goal * 100).toFixed(0)}% (${t.basis}): ${t.status === 'met' ? 'MET' : t.status === 'not_met' ? 'NOT MET' : `PRELIMINARY - n=${score.nModelEligible} is below ${t.minNForClaim}, do not present this as a result`}`);
if (failures.length) console.log(`  ${failures.length} model call(s) failed (those findings went to a person, not dropped): e.g. ${failures[0].model}: ${failures[0].error}`);

// The fallback / escalation log the rubric asks for: every non-trivial decision, why, and whether it was right.
const escLog = c.decisions.filter((d) => d.escalatedToClaude || d.escalatedToHuman).map((d) => ({ at: new Date().toISOString(), event: d.escalatedToHuman ? 'escalated_to_human' : 'escalated_to_claude', ...d, correct: d.verdict === 'needs_human' ? null : d.verdict === d.truth, modelFailures: failures.filter((f) => f.id === d.id).map((f) => f.model) }));
fs.writeFileSync(path.join(runDir, 'escalations.jsonl'), escLog.map((e) => JSON.stringify(e)).join('\n') + (escLog.length ? '\n' : ''));
const summary = meter.finish();
const report = { kind: 'eval-real', stamp: stamp(root), mode: replay ? 'replay' : 'live', labelsFile: path.relative(root, labelsFile), score: { ...score, cascade: { ...c, decisions: undefined } }, failures, costUsd: summary.totalUsd };
fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 1));
// "latest" file feeds the scorecard: only the real labelled set may write it (a test run on other labels must not).
if (labelsFile === path.join(root, 'eval/real-findings.labeled.jsonl')) fs.writeFileSync(path.join(root, 'runs/eval-real.json'), JSON.stringify(report, null, 1));
console.log(`  cost $${summary.totalUsd.toFixed(6)} | escalation log: ${path.relative(root, path.join(runDir, 'escalations.jsonl'))} | report: ${path.relative(root, path.join(runDir, 'report.json'))}`);
