// Scan any URL against the design-system rules, in light and dark mode.
// Usage: node scripts/scan.mjs <url> [--modes light,dark] [--width 1280] [--height 800] [--name label]
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, storageStateOption, ssoButtonOption, neededPageHeight } from '../src/browser.mjs';
import { Meter } from '../src/meter.mjs';
import { loadTokens, collect, runRules } from '../src/design-checks.mjs';
import { judge } from '../src/judge.mjs';
import { loadChecked } from '../src/guard.mjs';
import { stamp } from '../src/stamp.mjs';
import { makeCascade } from '../src/cascade.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
if (!url) { console.error('Usage: node scripts/scan.mjs <url> [--modes light,dark] [--width 1280] [--height 800] [--name label] [--judge | --cascade]'); process.exit(2); }

const root = path.resolve(import.meta.dirname, '..');
const modes = opt('modes', 'light,dark').split(',');
const viewport = { width: Number(opt('width', 1280)), height: Number(opt('height', 800)) };
const name = opt('name', 'scan');
const tokens = loadTokens(path.join(root, 'config/tokens.json'));
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing.json'), 'utf8'));
const runDir = path.join(root, 'runs', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const meter = new Meter({ runDir, pricing, plannedSteps: 2 + modes.length * 2 + (args.includes('--judge') || args.includes('--cascade') ? 1 : 0) });

let h = meter.start('launch');
const browser = await launchBrowser();
meter.end(h);
const page = await browser.newPage({ viewport, ...storageStateOption() });

h = meter.start('load', { url });
const loaded = await loadChecked(page, url, { ssoButton: ssoButtonOption() });
if (!loaded.ok) {
  meter.end(h);
  await page.screenshot({ path: path.join(runDir, 'not-run.png') }).catch(() => {});
  await browser.close();
  console.error(`NOT RUN: ${loaded.problem}\nNothing was tested. Check the app is running and reachable (curl -i ${url}).`);
  const summary = meter.finish();
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ url, kind: 'design', status: 'not_run', problem: loaded.problem, byRule: {}, violations: [] }, null, 2));
  process.exit(2);
}
await page.waitForTimeout(500);
// Freeze transitions so colors are read at their final value, not mid-fade after the dark-mode toggle.
await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important}' });
// Make the viewport as tall as the page so every element is on screen and its background can be measured.
const fullHeight = await neededPageHeight(page);
await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(fullHeight, viewport.height), 8000) });
meter.end(h);

const all = [];
let total = 0;
for (const mode of modes) {
  h = meter.start(`checks-${mode}`);
  await page.evaluate((m) => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
  await page.waitForTimeout(300);
  const els = await collect(page);
  total = Math.max(total, els.length);
  all.push(...runRules(els, tokens, { mode }));
  meter.end(h);
  h = meter.start(`screenshot-${mode}`);
  await page.screenshot({ path: path.join(runDir, `${mode}.png`) });
  meter.end(h);
}
await browser.close();

let judged = all;
if (args.includes('--cascade')) judged = await makeCascade({ meter, runDir }).triage(all); // Jev first, Claude for the uncertain ones
else if (args.includes('--judge')) judged = await judge(all, { meter, context: `Design-system scan of ${url} (netOS tokens). Contrast findings on text over images/gradients are skipped by the engine; the rest were measured from painted pixels.` });

const byRule = {};
for (const v of judged) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
console.log(`${url}\nElements checked: ${total} | violations: ${judged.length}`);
console.log('By rule:', JSON.stringify(byRule));
for (const v of judged.slice(0, 40)) console.log(`  [${v.severity}] ${v.key} :: ${v.detail}${v.verdict ? `  => ${v.verdict}` : ''}`);
if (judged.length > 40) console.log(`  ... ${judged.length - 40} more in report.json`);
const summary = meter.finish();
console.log(`Time ${summary.totalMs} ms | model cost $${summary.totalUsd.toFixed(6)} | report: ${runDir}`);
fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ stamp: stamp(root), url, byRule, kind: 'design', violations: judged }, null, 2));
