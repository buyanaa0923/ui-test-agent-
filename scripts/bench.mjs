// Mutation benchmark. Usage: node scripts/bench.mjs [--n 220] [--seed 1]
// Generates pages with a known injected defect (or none), runs the real rule engine on each, and scores it.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../src/browser.mjs';
import { Meter } from '../src/meter.mjs';
import { stamp } from '../src/stamp.mjs';
import { loadTokens, collect, runRules } from '../src/design-checks.mjs';
import { generateCases } from '../bench/generate.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? Number(args[i + 1]) : d; };
const n = opt('n', 220), seed = opt('seed', 1);
const root = path.resolve(import.meta.dirname, '..');
const ti = args.indexOf('--tokens');
const tokens = loadTokens(ti >= 0 ? path.resolve(args[ti + 1]) : path.join(root, 'config/tokens.json'));
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing.json'), 'utf8'));
const runDir = path.join(root, 'runs', `bench-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const meter = new Meter({ runDir, pricing, plannedSteps: 3 });

let h = meter.start('generate');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'bench/truth.json'), 'utf8'));
const cases = generateCases(truth, { seed, n }); // ground truth comes from bench/truth.json, the rule engine from config/tokens.json
meter.end(h);

h = meter.start('launch');
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
meter.end(h);

h = meter.start('evaluate', { cases: cases.length });
const per = {}; // rule -> {tp, fn, fp}
const bump = (r, k) => { (per[r] ||= { tp: 0, fn: 0, fp: 0 })[k]++; };
let exact = 0; const misses = [];
const negCases = cases.filter((c) => !c.rule);
let negDirty = 0;
const cl = fs.createWriteStream(path.join(runDir, 'cases.jsonl'));
for (const c of cases) {
  await page.setContent(c.html);
  const found = new Set(runRules(await collect(page), tokens, { mode: 'light' }).map((v) => v.key));
  const expected = new Set(c.expected);
  const fn = [...expected].filter((k) => !found.has(k)), fp = [...found].filter((k) => !expected.has(k));
  for (const k of expected) bump(k.split('|')[1], found.has(k) ? 'tp' : 'fn');
  for (const k of fp) bump(k.split('|')[1], 'fp');
  if (!fn.length && !fp.length) exact++;
  else misses.push({ index: c.index, rule: c.rule, missed: fn, unexpected: fp });
  if (!c.rule && found.size) negDirty++;
  cl.write(JSON.stringify({ index: c.index, rule: c.rule, expected: c.expected, found: [...found] }) + '\n');
}
cl.end();
meter.end(h);
await browser.close();

const f = (tp, fp, fn) => { const p = tp + fp ? tp / (tp + fp) : 1, r = tp + fn ? tp / (tp + fn) : 1; return { precision: +p.toFixed(4), recall: +r.toFixed(4), f1: +(p + r ? 2 * p * r / (p + r) : 0).toFixed(4) }; };
const rows = Object.entries(per).sort().map(([rule, v]) => ({ rule, ...v, ...f(v.tp, v.fp, v.fn) }));
const tot = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn }), { tp: 0, fp: 0, fn: 0 });
const summary = meter.finish();
const report = {
  kind: 'benchmark-mutation', stamp: stamp(root), seed, cases: cases.length, positives: cases.length - negCases.length, negatives: negCases.length,
  overall: { ...tot, ...f(tot.tp, tot.fp, tot.fn), exactMatchRate: +(exact / cases.length).toFixed(4), cleanPagesWithFindings: negDirty, falsePositiveRateOnCleanPages: +(negDirty / Math.max(negCases.length, 1)).toFixed(4) },
  perRule: rows, failures: misses, ms: summary.totalMs, usd: summary.totalUsd,
  note: 'Synthetic defects injected by this project; measures rule accuracy and false-positive behaviour, not generalisation to real apps.'
};
fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
const oi = args.indexOf('--out');
if (oi >= 0) fs.writeFileSync(path.resolve(args[oi + 1]), JSON.stringify(report, null, 2));
if (ti < 0 && oi < 0) fs.writeFileSync(path.join(root, 'runs', 'benchmark-mutation.json'), JSON.stringify(report, null, 2)); // 'latest' only for honest runs

console.log(`Mutation benchmark  seed=${seed}  cases=${cases.length} (${report.positives} defective, ${report.negatives} clean)`);
console.log('rule'.padEnd(26), 'TP'.padStart(4), 'FN'.padStart(4), 'FP'.padStart(4), 'prec'.padStart(7), 'recall'.padStart(7), 'F1'.padStart(7));
for (const r of rows) console.log(r.rule.padEnd(26), String(r.tp).padStart(4), String(r.fn).padStart(4), String(r.fp).padStart(4), r.precision.toFixed(3).padStart(7), r.recall.toFixed(3).padStart(7), r.f1.toFixed(3).padStart(7));
const o = report.overall;
console.log(`\nOverall  precision ${o.precision}  recall ${o.recall}  F1 ${o.f1}  exact-match ${(o.exactMatchRate * 100).toFixed(1)}%  false-positive rate on clean pages ${(o.falsePositiveRateOnCleanPages * 100).toFixed(1)}%`);
console.log(`Time ${summary.totalMs} ms | model cost $${summary.totalUsd.toFixed(4)} | ${runDir}`);
if (misses.length) { console.log(`\n${misses.length} case(s) not exact, first 8:`); for (const m of misses.slice(0, 8)) console.log(' ', JSON.stringify(m)); }
process.exit(misses.length ? 1 : 0);
