// Collect real findings into an UNLABELLED evaluation set and a review sheet for two engineers.
// Usage: node scripts/eval/collect-real.mjs [--since ISO] [--flow-since ISO] [--host localhost:5200 ...] [--flow-only-host localhost:5181 ...] [--force]
// Writes: eval/real-findings.jsonl (label field empty), eval/real-findings.meta.json (how it was collected),
//         review/real-findings/{sheet.html,labels-template.csv,assets/}
import fs from 'node:fs';
import path from 'node:path';
import { buildRecords, readRuns } from '../../src/eval/real-findings.mjs';
import { buildSheetHtml, buildTemplateCsv } from '../../src/eval/review-sheet.mjs';
import { stamp } from '../../src/core/stamp.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const args = process.argv.slice(2);
const multi = (k, dflt) => { const v = args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : [])); return v.length ? v : dflt; };
const one = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const root = ROOT;
const out = path.join(root, 'eval/real-findings.jsonl');
const sheetDir = path.join(root, 'review/real-findings');
const hosts = multi('host', ['localhost:5200', 'localhost:5300']);
const flowOnlyHosts = multi('flow-only-host', ['localhost:5181']);
const since = one('since');
const flowSince = one('flow-since', since);

if (fs.existsSync(out) && !args.includes('--force')) {
  const labelled = fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => (r.label || '').trim());
  if (labelled.length) { console.error(`Refusing to overwrite ${out}: ${labelled.length} record(s) already carry labels. Labels belong in the CSVs (see real-labels); use --force only if you mean it.`); process.exit(2); }
}

const runs = readRuns(path.join(root, 'runs'));
const records = buildRecords(runs, { hosts, flowOnlyHosts, since, flowSince });
if (!records.length) { console.error('No real findings found (no matching runs). Nothing written.'); process.exit(2); }

const pngSize = (f) => { try { const b = fs.readFileSync(f); return b.toString('ascii', 1, 4) === 'PNG' ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null; } catch { return null; } };
fs.rmSync(path.join(sheetDir, 'assets'), { recursive: true, force: true });
fs.mkdirSync(path.join(sheetDir, 'assets'), { recursive: true });
const assets = {};
for (const r of records) {
  const shot = r.source.shots.light || r.source.shots.dark || r.source.shots.step;
  if (!shot || !fs.existsSync(shot)) { assets[r.id] = null; continue; }
  const dest = `assets/${r.id}.png`;
  fs.copyFileSync(shot, path.join(sheetDir, dest));
  assets[r.id] = { src: dest, ...(pngSize(shot) || {}) };
}

// The record file keeps provenance but not absolute screenshot paths on this machine.
const slim = records.map((r) => ({ ...r, source: { ...r.source, shots: undefined } }));
fs.writeFileSync(out, slim.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(sheetDir, 'sheet.html'), buildSheetHtml(records, assets));
fs.writeFileSync(path.join(sheetDir, 'labels-template.csv'), buildTemplateCsv(records));

const byRule = {}, byKind = {};
for (const r of records) { byRule[r.finding.rule] = (byRule[r.finding.rule] || 0) + 1; byKind[r.source.kind] = (byKind[r.source.kind] || 0) + 1; }
const usedRuns = new Set(records.flatMap((r) => r.source.runs));
fs.writeFileSync(path.join(root, 'eval/real-findings.meta.json'), JSON.stringify({
  collectedAt: new Date().toISOString(), collectedWith: stamp(root), hosts, flowOnlyHosts, since, flowSince,
  note: 'One record per distinct defect (light/dark and repeats across pages merged). Earlier model verdicts were dropped. Labels are empty on purpose: two engineers label independently via review/real-findings/sheet.html.',
  records: records.length, byRule, byKind, runsUsed: usedRuns.size, runsScanned: runs.length
}, null, 2));

console.log(`Wrote ${records.length} unlabelled records from ${usedRuns.size} runs -> eval/real-findings.jsonl`);
console.log(`  by rule: ${JSON.stringify(byRule)}   by kind: ${JSON.stringify(byKind)}`);
console.log(`Review sheet: review/real-findings/sheet.html  (each engineer labels alone, then downloads labels-<name>.csv)`);
