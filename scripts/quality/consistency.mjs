// Style-consistency benchmark. Usage: node scripts/quality/consistency.mjs [--seed 1] [--out file.json] [--sabotage name]
// Builds seeded sites (bench/style-sites.mjs): clean ones, and ones with exactly one page drifted into another style
// vocabulary while every value stays inside the tokens. Measures each page in a real browser, runs the fingerprint
// outlier check per site, and scores it: the drifted page must be flagged, and no other page, on no clean site.
// It also runs the design rules on the same pages, to show what the rules alone see.
// --sabotage proves the benchmark can fail: no-corners / no-depth drop a feature family, overfire makes every feature
// strong with no thresholds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../../src/engine/browser.mjs';
import { collect, runRules } from '../../src/engine/design-checks.mjs';
import { resolveContract } from '../../src/engine/contract.mjs';
import { fingerprint, styleOutliers, FEATURES } from '../../src/engine/fingerprint.mjs';
import { generateSites } from '../../bench/style-sites.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const seed = Number(arg('seed', 1));
const sabotage = arg('sabotage', null);
const features = !sabotage ? FEATURES
  : sabotage === 'no-corners' ? Object.fromEntries(Object.entries(FEATURES).filter(([, f]) => f.family !== 'corners'))
  : sabotage === 'no-depth' ? Object.fromEntries(Object.entries(FEATURES).filter(([, f]) => f.family !== 'depth'))
  : sabotage === 'overfire' ? Object.fromEntries(Object.entries(FEATURES).map(([k, f]) => [k, { ...f, tier: 'strong', floor: 1e-6, min: 0, margin: 0, extreme: 0 }]))
  : (() => { throw new Error(`unknown sabotage "${sabotage}"`); })();

const designFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mole-consistency-')), 'DESIGN.md');
fs.writeFileSync(designFile, '# Design: benchmark\n\n```mole\nextends: modern-web\n```\n');
const contract = resolveContract({ design: designFile });

const t0 = Date.now();
const cases = generateSites({ seed });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];
const ruleFindings = { drifted: [], clean: [] };
for (const c of cases) {
  const measured = [];
  for (const pg of c.pages) {
    await page.setContent(pg.html);
    const els = await collect(page);
    measured.push({ path: pg.path, fp: fingerprint(els), odd: pg.odd });
    (pg.odd ? ruleFindings.drifted : ruleFindings.clean).push(runRules(els, contract, { mode: 'light' }).length);
  }
  const r = styleOutliers(measured, { features });
  const flagged = new Set(r.outliers.map((o) => o.path));
  const odd = measured.find((m) => m.odd)?.path || null;
  const invisible = c.pages.some((p) => p.odd && p.invisible);
  const keys = Object.keys(features).filter((k) => k !== 'fontShare');
  const oddFp = measured.find((m) => m.odd)?.fp;
  rows.push({
    base: c.base, mutation: c.mutation, odd, invisible, flagged: [...flagged], hit: odd ? flagged.has(odd) : null, falseAlarms: [...flagged].filter((p) => p !== odd).length, top: r.outliers[0]?.path || null,
    why: r.outliers.find((o) => o.path === odd)?.differences.map((d) => d.text) || [],
    alarms: r.outliers.filter((o) => o.path !== odd).map((o) => ({ path: o.path, type: c.pages.find((p) => p.path === o.path)?.type, why: o.differences.map((d) => d.text) })),
    ...(odd && !flagged.has(odd) ? { oddType: c.pages.find((p) => p.odd).type, oddFp: Object.fromEntries(keys.map((k) => [k, oddFp[k]])), othersFp: Object.fromEntries(keys.map((k) => [k, measured.filter((m) => !m.odd).map((m) => m.fp[k])])), support: oddFp.support } : {}),
  });
}
await browser.close();

const per = {};
for (const r of rows.filter((x) => x.mutation && !x.invisible)) { const k = r.mutation; (per[k] ||= { cases: 0, caught: 0, topRanked: 0, falseAlarms: 0 }); per[k].cases++; per[k].caught += r.hit ? 1 : 0; per[k].topRanked += r.top === r.odd ? 1 : 0; per[k].falseAlarms += r.falseAlarms; }
const drifted = rows.filter((r) => r.mutation && !r.invisible), invisible = rows.filter((r) => r.invisible), clean = rows.filter((r) => !r.mutation);
const tp = drifted.filter((r) => r.hit).length, fp = rows.reduce((a, r) => a + r.falseAlarms, 0);
const pagesClean = rows.reduce((a, r, i) => a + cases[i].pages.filter((p) => !p.odd).length, 0);
const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 0);
const overall = {
  sites: rows.length, driftedSites: drifted.length, cleanSites: clean.length, nothingToDrift: invisible.length, // drifts that left the page unchanged: not scored
  recall: +(tp / drifted.length).toFixed(3), precision: +(tp / Math.max(tp + fp, 1)).toFixed(3),
  cleanSitesWithAnyFlag: clean.filter((r) => r.flagged.length).length, falseAlarmRatePerPage: +(fp / pagesClean).toFixed(4),
  ruleFindingsPerPage: { drifted: avg(ruleFindings.drifted), clean: avg(ruleFindings.clean) },
};
const report = { seed, sabotage, ms: Date.now() - t0, overall, perMutation: per, misses: drifted.filter((r) => !r.hit).map(({ base, mutation, odd, oddType, oddFp, othersFp, support }) => ({ base, mutation, odd, oddType, oddFp, othersFp, support })), falseAlarms: rows.filter((r) => r.falseAlarms).map(({ base, mutation, odd, alarms }) => ({ base, mutation, odd, alarms })), example: drifted.find((r) => r.mutation === 'off-style' && r.hit) };
const out = arg('out', path.join(ROOT, 'runs', `consistency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log(`Style consistency benchmark  seed ${seed}${sabotage ? `  SABOTAGE ${sabotage}` : ''}  (${rows.length} sites, ${rows.reduce((a, _, i) => a + cases[i].pages.length, 0)} pages)\n`);
console.log('drift             sites  caught  top-ranked  false alarms');
for (const [k, v] of Object.entries(per)) console.log(`${k.padEnd(17)} ${String(v.cases).padStart(5)}  ${String(v.caught).padStart(6)}  ${String(v.topRanked).padStart(10)}  ${String(v.falseAlarms).padStart(12)}`);
if (invisible.length) console.log(`(${invisible.length} drifted site${invisible.length === 1 ? '' : 's'} not scored: the drift had nothing to change on that page)`);
console.log(`\nOverall  recall ${overall.recall}  precision ${overall.precision}  clean sites with any flag ${overall.cleanSitesWithAnyFlag}/${clean.length}  false alarms per page ${overall.falseAlarmRatePerPage}`);
console.log(`Design rules on the same pages: ${overall.ruleFindingsPerPage.drifted} findings per drifted page, ${overall.ruleFindingsPerPage.clean} per clean page (what the rules alone see)`);
if (report.example) console.log(`\nExample (${report.example.base} site, ${report.example.odd}):\n  ${report.example.why.join('\n  ')}`);
console.log(`\n${out}`);
// Gates: overall recall 0.95 and every drift 0.85 (one miss in 8 cases is 12.5 points, so a per-drift 0.9 bar would mean
// "never miss"); precision 0.95; and not one clean site flagged, because false alarms are what make people stop reading.
const pass = overall.recall >= 0.95 && Object.values(per).every((v) => v.caught / v.cases >= 0.85) && overall.cleanSitesWithAnyFlag === 0 && overall.precision >= 0.95;
process.exit(pass ? 0 : 1);
