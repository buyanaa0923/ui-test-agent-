// Determinism: the same page scanned N times in fresh browser contexts must give byte-identical findings.
// Usage: node scripts/quality/determinism.mjs [--runs 20] [--url <url>]  (default: sample page + 10 generated pages)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../../src/engine/browser.mjs';
import { loadTokens, collect, runRules } from '../../src/engine/design-checks.mjs';
import { generateCases } from '../../bench/generate.mjs';
import { stamp } from '../../src/core/stamp.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const runs = Number(opt('runs', 20));
const root = ROOT;
const tokens = loadTokens(path.join(root, 'config/tokens.json'));
const truth = JSON.parse(fs.readFileSync(path.join(root, 'bench/truth.json'), 'utf8'));

const targets = opt('url', null)
  ? [{ name: opt('url'), load: (p) => p.goto(opt('url'), { waitUntil: 'networkidle' }) }]
  : [{ name: 'sample.html', load: (p) => p.goto(pathToFileURL(path.join(root, 'test-pages/sample.html')).href) },
     ...generateCases(truth, { seed: 7, n: 40 }).slice(0, 10).map((c) => ({ name: `generated#${c.index}`, load: (p) => p.setContent(c.html) }))];

const browser = await launchBrowser();
const rows = [];
for (const t of targets) {
  const hashes = new Set();
  let count = 0;
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await t.load(page);
    const v = runRules(await collect(page), tokens, { mode: 'light' }).map((x) => `${x.key}|${x.detail}`).sort();
    count = v.length;
    hashes.add(crypto.createHash('sha256').update(v.join('\n')).digest('hex'));
    await ctx.close();
  }
  rows.push({ target: t.name, runs, findings: count, distinctOutputs: hashes.size, deterministic: hashes.size === 1 });
}
await browser.close();

const ok = rows.every((r) => r.deterministic);
for (const r of rows) console.log(`${r.deterministic ? 'ok  ' : 'FAIL'} ${r.target.padEnd(20)} ${r.runs} runs, ${r.findings} findings, ${r.distinctOutputs} distinct output(s)`);
console.log(`\nDeterminism: ${rows.filter((r) => r.deterministic).length}/${rows.length} pages identical across ${runs} fresh runs`);
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
fs.writeFileSync(path.join(root, 'runs', 'determinism.json'), JSON.stringify({ stamp: stamp(root), runs, pages: rows.length, allDeterministic: ok, rows }, null, 2));
process.exit(ok ? 0 : 1);
