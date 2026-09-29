// Smoke test: the deterministic checks must find exactly the seeded violations on the sample page
// (no more, no fewer), using the REAL tokens imported from the design system.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/browser.mjs';
import { Meter } from '../src/meter.mjs';
import { loadTokens, collect, runRules } from '../src/design-checks.mjs';

const root = path.resolve(import.meta.dirname, '..');
const expected = new Set(JSON.parse(fs.readFileSync(path.join(root, 'test-pages/sample.expected.json'), 'utf8')));
const tokens = loadTokens(path.join(root, 'config/tokens.json'));
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing.json'), 'utf8'));

const runDir = path.join(root, 'runs', `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const meter = new Meter({ runDir, pricing, plannedSteps: 4 });

let h = meter.start('launch');
const browser = await launchBrowser();
meter.end(h);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

h = meter.start('load');
await page.goto(pathToFileURL(path.join(root, 'test-pages/sample.html')).href);
meter.end(h);

h = meter.start('design-checks');
const elements = await collect(page);
const violations = runRules(elements, tokens, { mode: 'light' });
meter.end(h);

h = meter.start('screenshot');
await page.screenshot({ path: path.join(runDir, 'page.png'), fullPage: true });
meter.end(h);
await browser.close();

const found = new Set(violations.map((v) => v.key));
const missed = [...expected].filter((k) => !found.has(k));
const unexpected = [...found].filter((k) => !expected.has(k));

console.log(`Tokens: ${tokens.source.package}@${tokens.source.version}`);
console.log(`Checked ${elements.length} visible elements. Violations found: ${violations.length}\n`);
for (const v of violations) console.log(`  ${v.key.padEnd(36)} ${v.severity.padEnd(7)} ${v.detail}`);
console.log(`\nSeeded bugs caught : ${expected.size - missed.length}/${expected.size}`);
console.log(`Missed             : ${missed.join(', ') || 'none'}`);
console.log(`Unexpected (false+): ${unexpected.join(', ') || 'none'}`);

const summary = meter.finish();
console.log(`\nRun time ${summary.totalMs} ms, model cost $${summary.totalUsd.toFixed(6)}`);
fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ kind: 'benchmark', url: 'test-pages/sample.html', byRule: {}, violations, missed, unexpected }, null, 2));
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
fs.writeFileSync(path.join(root, 'runs', 'benchmark.json'), JSON.stringify({ at: new Date().toISOString(), seeded: expected.size, caught: expected.size - missed.length, missed, falsePositives: unexpected, ms: summary.totalMs, usd: summary.totalUsd }, null, 2));
process.exit(missed.length || unexpected.length ? 1 : 0);
