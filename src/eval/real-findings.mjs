// Turn the findings of real runs (real apps, not the mutation benchmark) into a de-duplicated, UNLABELLED evaluation set.
// One record per distinct defect: light/dark variants and repeats across pages merge. Earlier model verdicts are dropped on purpose,
// so the set stays held out from everything that ran before humans looked at it. Ids are content hashes, so re-collecting never
// shifts a label onto the wrong finding.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const signature = (f) => [f.rule, f.element, (f.text || '').trim(), (f.ctx?.ancestors || []).join('>')].join('|');
export const recordId = (f) => `real-${crypto.createHash('sha1').update(signature(f)).digest('hex').slice(0, 8)}`;

const KEEP = ['key', 'rule', 'element', 'text', 'detail', 'mode', 'severity', 'ctx'];
const clean = (f) => Object.fromEntries(KEEP.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

// runs: [{ runId, dir?, report }]. opts: { hosts, flowOnlyHosts, since, flowSince }
// cluster = rule + measured value with the mode wording removed: findings sharing a root cause (e.g. the same brand color under many buttons) share a cluster.
export function buildRecords(runs, { hosts = [], flowOnlyHosts = [], since = null, flowSince = null } = {}) {
  const groups = new Map();
  for (const { runId, dir, report } of runs) {
    if (!report || !['design', 'flow'].includes(report.kind) || report.status === 'not_run' || !report.url) continue;
    let host; try { const u = new URL(report.url); if (!/^https?:$/.test(u.protocol)) continue; host = u.host; } catch { continue; }
    const allowed = report.kind === 'design' ? hosts.includes(host) : hosts.includes(host) || flowOnlyHosts.includes(host);
    if (!allowed) continue;
    const at = report.stamp?.at;
    const cutoff = report.kind === 'flow' ? (flowSince ?? since) : since; // independent cutoffs: design and flow tools were fixed at different times
    if (cutoff && at && at < new Date(cutoff).toISOString()) continue;
    for (const f of report.violations || []) {
      if (report.kind === 'flow' && f.mode && f.mode !== 'flow') continue; // design checks a tunnel ran on its pages: not collected (yet)
      const id = recordId(f);
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { id, kind: report.kind, byMode: new Map(), pages: new Set(), runs: new Set(), stamp: report.stamp || null, at: at || null, shots: {} }));
      if (!g.byMode.has(f.mode)) g.byMode.set(f.mode, f);
      g.pages.add(report.url); g.runs.add(runId);
      if (at && (!g.at || at < g.at)) { g.at = at; g.stamp = report.stamp || g.stamp; }
      if (dir) {
        if (report.kind === 'design' && f.mode && !g.shots[f.mode]) g.shots[f.mode] = path.join(dir, `${f.mode}.png`);
        if (report.kind === 'flow' && f.step && !g.shots.step) g.shots.step = path.join(dir, `step-${String(f.step).padStart(2, '0')}.png`);
      }
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const primary = g.byMode.get('light') || g.byMode.get('flow') || [...g.byMode.values()][0];
    const pages = [...g.pages].sort();
    out.push({
      id: g.id,
      why: `${primary.rule}: ${primary.text ? `"${String(primary.text).slice(0, 40)}"` : primary.element} (${pages.length} page${pages.length === 1 ? '' : 's'})`,
      positive: null,
      label: '',
      finding: clean(primary),
      source: {
        kind: g.kind, pages, modes: [...g.byMode.keys()].sort(),
        detailByMode: Object.fromEntries([...g.byMode].map(([m, f]) => [m, f.detail])),
        cluster: `${primary.rule}|${String(primary.detail || '').replace(/\((light|dark) mode\)/g, '').trim()}`,
        rect: primary.rect || null, runs: [...g.runs].sort(), firstSeen: g.at, stamp: g.stamp, shots: g.shots
      }
    });
  }
  return out.sort((a, b) => a.finding.rule.localeCompare(b.finding.rule) || a.finding.element.localeCompare(b.finding.element) || (a.finding.text || '').localeCompare(b.finding.text || '') || a.id.localeCompare(b.id));
}

export function readRuns(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const out = [];
  for (const d of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(runsDir, d.name), file = path.join(dir, 'report.json');
    if (!fs.existsSync(file)) continue;
    try { out.push({ runId: d.name, dir, report: JSON.parse(fs.readFileSync(file, 'utf8')) }); } catch { /* unreadable run: skip */ }
  }
  return out;
}
