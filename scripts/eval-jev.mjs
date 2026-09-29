// Evaluate Jev (and Claude, and the Jev->Claude cascade) on labelled decisions.
// Usage: node scripts/eval-jev.mjs [--set risk|triage|all] [--claude] [--replay] [--gate 0.8]
//   live run   : calls Jev (needs TYPESAFE_API_KEY), records every response in eval/cache/
//   --replay   : scores from eval/cache/ only - no network, no cost, same numbers (what a judge can rerun)
//   --claude   : also runs Claude on the same cases (needs ANTHROPIC_API_KEY, or a recorded run) for the comparison
import fs from 'node:fs';
import path from 'node:path';
import { classifyRisk, triageFinding } from '../src/jev.mjs';
import { judge, claudeRisk } from '../src/judge.mjs';
import { fileCache } from '../src/cache.mjs';
import { Meter } from '../src/meter.mjs';
import { stamp } from '../src/stamp.mjs';
import { exemptReason } from '../src/exemptions.mjs';
import { scoreBinary, ece, coverage, latency, costOf, round } from '../src/metrics.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const set = opt('set', 'all'), replay = args.includes('--replay'), withClaude = args.includes('--claude');
const gate = Number(opt('gate', 0.8)), gateDismiss = Math.min(0.99, gate + 0.1);
const root = path.resolve(import.meta.dirname, '..');
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing.json'), 'utf8'));
const runDir = path.join(root, 'runs', `eval-jev-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const meter = new Meter({ runDir, pricing, maxUsd: Number(process.env.BUDGET_USD || 2) });
const cacheRoot = process.env.EVAL_CACHE_DIR || path.join(root, 'eval/cache'); // tests point this elsewhere
const jevCache = fileCache(path.join(cacheRoot, 'jev'), { replayOnly: replay });
const claudeCache = fileCache(path.join(cacheRoot, 'claude'), { replayOnly: replay });
const load = (f) => fs.readFileSync(path.join(root, 'eval', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const cost = (u) => (u ? meter.costOf(u.model, u.inputTokens, u.outputTokens) : null);

async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); } })); return out; }

// Claude calls go through the same cache so a recorded run can be replayed offline.
const cachedSend = (send) => async (prompt) => {
  const hit = claudeCache.get({ prompt });
  if (hit) return hit;
  if (replay) throw new Error('replay mode: no recorded Claude response');
  const r = await send(prompt);
  claudeCache.put({ prompt }, r);
  return r;
};

async function runJev(items, fn) {
  return pool(items, 4, async (it) => {
    try {
      const r = await fn(it);
      return { id: it.id, positive: it.positive, pred: r.pred, confidence: r.confidence, p: r.p, ms: r.ms, costUsd: cost(r.usage), lang: it.lang, why: it.why || it.label };
    } catch (e) { return { id: it.id, positive: it.positive, error: e.message, lang: it.lang }; }
  });
}

// Claude arm. Sends via the real API unless replaying; `send` is only reached on a cache miss.
async function claudeArmRisk(items) {
  const { viaApiForEval } = await import('../src/judge.mjs');
  return pool(items, 3, async (it) => {
    try {
      const r = await claudeRisk({ label: it.label, context: it.context }, { meter, send: cachedSend(viaApiForEval.risk()) });
      return { id: it.id, positive: it.positive, pred: r.risky, confidence: r.confidence, ms: null, costUsd: cost(r.usage), lang: it.lang };
    } catch (e) { return { id: it.id, positive: it.positive, error: e.message, lang: it.lang }; }
  });
}
async function claudeArmTriage(items) {
  const { viaApiForEval } = await import('../src/judge.mjs');
  const out = [];
  for (let i = 0; i < items.length; i += 8) { // batches of 8: the cheapest realistic Claude-only setup
    const chunk = items.slice(i, i + 8);
    const spent0 = meter.spentUsd();
    const j = await judge(chunk.map((c) => c.finding), { meter, send: cachedSend(viaApiForEval.judge) });
    const per = (meter.spentUsd() - spent0) / chunk.length;
    chunk.forEach((c, k) => out.push({ id: c.id, positive: c.positive, pred: j[k].verdict === 'real', confidence: j[k].verdict === 'unjudged' ? 0 : 1, unjudged: j[k].verdict === 'unjudged', ms: null, costUsd: per, why: c.why }));
  }
  return out;
}

const report = { kind: 'eval-jev', stamp: stamp(root), mode: replay ? 'replay' : 'live', gates: { confirm: gate, dismiss: gateDismiss }, sets: {} };

async function evalSet(name, items, jevFn, claudeFn) {
  process.stdout.write(`\n== ${name} (${items.length} labelled decisions) ==\n`);
  const h = meter.start(`jev-${name}`, { n: items.length });
  const jev = await runJev(items, jevFn);
  meter.end(h);
  const ok = jev.filter((r) => !r.error), failed = jev.filter((r) => r.error);
  if (failed.length) console.log(`  ${failed.length} Jev call(s) failed, e.g. ${failed[0].error}`);
  const s = { n: items.length, answered: ok.length, failed: failed.length, jev: { ...scoreBinary(ok), calibration: ece(ok), coverage: coverage(ok), latencyMs: latency(ok), costUsd: costOf(ok), costPer1kDecisions: round((costOf(ok) / Math.max(ok.length, 1)) * 1000, 5) } };
  if (ok.some((r) => r.lang)) s.jev.byLanguage = Object.fromEntries(['en', 'mn'].map((l) => [l, scoreBinary(ok.filter((r) => r.lang === l))]).filter(([, v]) => v.n));
  console.log(`  Jev     accuracy ${s.jev.accuracy}  precision ${s.jev.precision}  recall ${s.jev.recall}  ECE ${s.jev.calibration.ece}  p50 ${s.jev.latencyMs.p50 ?? 'n/a'} ms  cost/1k $${s.jev.costPer1kDecisions}`);
  if (s.jev.byLanguage) for (const [l, v] of Object.entries(s.jev.byLanguage)) console.log(`          ${l.toUpperCase()}: accuracy ${v.accuracy} (n=${v.n})`);
  console.log('  gate   coverage  accuracy-on-covered');
  for (const c of s.jev.coverage) console.log(`  ${c.gate.toFixed(2)}   ${(c.coverage * 100).toFixed(0).padStart(5)}%   ${(c.accuracy * 100).toFixed(1).padStart(6)}%`);

  let claudeRecs = null, cascRecs = null;
  if (withClaude) {
    const h2 = meter.start(`claude-${name}`, { n: items.length });
    claudeRecs = (await claudeFn(items)).filter((r) => !r.error);
    const cl = claudeRecs;
    meter.end(h2);
    const cs = { ...scoreBinary(cl), costUsd: costOf(cl), costPer1kDecisions: round((costOf(cl) / Math.max(cl.length, 1)) * 1000, 4) };
    s.claude = cs;
    console.log(`  Claude  accuracy ${cs.accuracy}  precision ${cs.precision}  recall ${cs.recall}  cost/1k $${cs.costPer1kDecisions}`);
    // cascade: Jev decides when confident (asymmetric gates), otherwise Claude decides
    const byId = new Map(cl.map((r) => [r.id, r]));
    const casc = ok.filter((r) => byId.has(r.id)).map((r) => {
      const conf = r.pred ? gate : gateDismiss;
      const useJev = r.confidence >= conf;
      const c = byId.get(r.id);
      return { id: r.id, positive: r.positive, pred: useJev ? r.pred : c.pred, confidence: 1, escalated: !useJev, costUsd: (r.costUsd ?? 0) + (useJev ? 0 : c.costUsd ?? 0) };
    });
    cascRecs = casc;
    const esc = casc.filter((r) => r.escalated).length;
    s.cascade = { ...scoreBinary(casc), escalationRate: round(esc / Math.max(casc.length, 1)), costUsd: costOf(casc), costPer1kDecisions: round((costOf(casc) / Math.max(casc.length, 1)) * 1000, 4), costVsClaudeOnly: round(costOf(casc) / Math.max(costOf(cl), 1e-12), 3) };
    console.log(`  Cascade accuracy ${s.cascade.accuracy}  escalated ${(s.cascade.escalationRate * 100).toFixed(0)}%  cost ${(s.cascade.costVsClaudeOnly * 100).toFixed(0)}% of Claude-only`);
  }
  const label = new Map(items.map((i) => [i.id, i.label || i.why]));
  const wrong = (recs) => recs.filter((r) => !r.error && r.pred !== r.positive).map((r) => `${label.get(r.id)} [truth ${r.positive ? 'positive' : 'negative'}${r.p != null ? `, p=${r.p}` : ''}]`);
  s.jev.errors = wrong(ok);
  if (s.claude) { s.claude.errors = wrong(claudeRecs); s.cascade.errors = wrong(cascRecs); fs.writeFileSync(path.join(runDir, `${name}.claude.json`), JSON.stringify(claudeRecs, null, 1)); fs.writeFileSync(path.join(runDir, `${name}.cascade.json`), JSON.stringify(cascRecs, null, 1)); }
  console.log(`  Jev wrong on ${s.jev.errors.length}: ${s.jev.errors.slice(0, 6).join(' | ')}${s.jev.errors.length > 6 ? ' ...' : ''}`);
  if (s.claude) console.log(`  Claude wrong on ${s.claude.errors.length}: ${s.claude.errors.slice(0, 6).join(' | ')}${s.claude.errors.length > 6 ? ' ...' : ''}`);

  // Pipeline view: structural exemptions are decided by rules (free, exact) and never reach a model.
  const detIds = new Set(items.filter((it) => it.finding && exemptReason(it.finding.rule, it.finding.ctx)).map((it) => it.id));
  if (detIds.size) {
    const overlay = (r) => (detIds.has(r.id) ? { ...r, pred: false, confidence: 1, costUsd: 0, escalated: false } : r);
    const detWrong = items.filter((it) => detIds.has(it.id) && it.positive).length;
    const p = { deterministicResolved: detIds.size, deterministicWrong: detWrong, modelCases: items.length - detIds.size, jev: scoreBinary(ok.map(overlay)) };
    if (s.claude) {
      p.claude = scoreBinary(claudeRecs.map(overlay));
      const c2 = cascRecs.map(overlay);
      p.cascade = { ...scoreBinary(c2), escalationRate: round(c2.filter((r) => r.escalated).length / c2.length), costPer1kDecisions: round((costOf(c2) / c2.length) * 1000, 4), costVsClaudeOnly: round(costOf(c2) / Math.max(costOf(claudeRecs.map((r) => (detIds.has(r.id) ? { ...r, costUsd: 0 } : r))), 1e-12), 3) };
    }
    s.pipeline = p;
    console.log(`  Pipeline with deterministic exemptions (${detIds.size} of ${items.length} cases decided by rules, ${detWrong} wrong): Jev ${p.jev.accuracy}${p.claude ? `, Claude ${p.claude.accuracy}, cascade ${p.cascade.accuracy} at ${(p.cascade.costVsClaudeOnly * 100).toFixed(0)}% of Claude-only cost` : ''}`);
    console.log('  (These exemptions were added after seeing errors on this same set: treat this as a development number, not a held-out result.)');
  }
  fs.writeFileSync(path.join(runDir, `${name}.decisions.json`), JSON.stringify(jev, null, 1));
  report.sets[name] = s;
}

const jevOpts = { cache: jevCache };
if (set === 'risk' || set === 'all') {
  await evalSet('risk', load('risk.jsonl'),
    async (it) => { const r = await classifyRisk({ label: it.label, context: it.context }, jevOpts); return { pred: r.risky, confidence: r.confidence, p: r.p, ms: r.ms, cached: r.cached, usage: r.usage }; },
    claudeArmRisk);
}
if (set === 'triage' || set === 'all') {
  await evalSet('triage', load('triage.jsonl'),
    async (it) => { const r = await triageFinding(it.finding, jevOpts); return { pred: r.real, confidence: r.confidence, p: r.p, ms: r.ms, cached: r.cached, usage: r.usage }; },
    claudeArmTriage);
}
const summary = meter.finish();
report.ms = summary.totalMs; report.usd = summary.totalUsd;
fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
if (!process.env.EVAL_CACHE_DIR) fs.writeFileSync(path.join(root, 'runs', 'eval-jev.json'), JSON.stringify(report, null, 2)); // 'latest' only for real runs
if (process.env.EVAL_REPORT) fs.writeFileSync(process.env.EVAL_REPORT, JSON.stringify(report, null, 2));
console.log(`\nTime ${summary.totalMs} ms | ${replay ? 'recorded cost of the replayed calls (no new spend)' : 'spend'} $${summary.totalUsd.toFixed(5)} | ${runDir}`);
