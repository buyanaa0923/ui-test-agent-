// The pipeline gate: run mole over a list of URLs and turn the result into an exit code plus an evidence folder.
// Exit: 0 every page clean, 1 defects found, 2 NOT RUN (at least one page could not be tested: a failure, never a pass).
// Built to be one line in a pipeline stage: `mole ci --urls urls.txt --out evidence/runs/<run-id>`.
import fs from 'node:fs';
import path from 'node:path';
import { EventBus } from '../../core/events.mjs';
import { EXIT } from '../../core/errors.mjs';
import { stamp } from '../../core/stamp.mjs';
import { P } from '../../core/paths.mjs';
import { dig } from '../../engine/dig.mjs';
import { tunnel } from '../../engine/tunnel.mjs';
import { detectTheme, bannerLines, version } from '../../ui/terminal/index.mjs';
import { fmtMs, fmtUsd, truncate, padEnd } from '../../ui/terminal/theme.mjs';
import { outputOptions, modelOptions, resolveTriage, num } from '../options.mjs';

const readUrls = (file) => fs.readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const worst = (codes) => (codes.includes(EXIT.NOT_RUN) ? EXIT.NOT_RUN : codes.includes(EXIT.DEFECTS) ? EXIT.DEFECTS : EXIT.PASS);

function copyEvidence(result, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.existsSync(result.runDir) ? fs.readdirSync(result.runDir) : []) {
    if (/\.(png|json|jsonl)$/.test(f)) fs.copyFileSync(path.join(result.runDir, f), path.join(dest, f));
  }
}

export default {
  name: 'ci',
  summary: 'Pipeline gate: scan a list of URLs, write evidence, exit 0 (pass) / 1 (defects) / 2 (not run)',
  usage: 'mole ci --urls urls.txt [--out evidence/runs/<id>] [--tunnel]',
  positionals: 0,
  options: {
    urls: { type: 'string', description: 'file with one URL per line (# comments allowed)' },
    url: { type: 'string', multiple: true, description: 'a URL to test (repeatable)' },
    out: { type: 'string', description: 'evidence folder (default evidence/runs/mole-<timestamp>)' },
    tunnel: { type: 'boolean', description: 'also click through each page (dead buttons, JS errors, failed requests)' },
    max: { type: 'string', default: '12', description: 'maximum clicks per page when --tunnel is set' },
    'allow-origin': { type: 'string', multiple: true, description: 'let requests to this origin through (repeatable)' },
    'storage-state': { type: 'string', description: 'Playwright storageState file for pages behind login' },
    'sso-button': { type: 'string', description: "regex for the app's own sign-in button" },
    'max-usd': { type: 'string', description: 'hard stop on model spend per page in USD' },
    ...modelOptions, ...outputOptions,
  },
  async run({ values }) {
    if (values['no-color']) process.env.NO_COLOR = '1';
    const urls = [...(values.urls ? readUrls(path.resolve(values.urls)) : []), ...(values.url || [])];
    if (!urls.length) { process.stderr.write('mole ci: give --urls <file> or --url <url>\n'); return 64; }
    const t = detectTheme(process.stdout);
    const json = !!values.json;
    const out = (s = '') => !json && process.stdout.write(s + '\n');
    const id = `mole-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const evidenceDir = path.resolve(values.out || path.join('evidence', 'runs', id));
    fs.mkdirSync(evidenceDir, { recursive: true });
    const triage = resolveTriage(values);
    const shared = { storageState: values['storage-state'] || process.env.UTA_STORAGE_STATE || null, ssoButton: values['sso-button'] || process.env.UTA_SSO_BUTTON || null, maxUsd: values['max-usd'] != null ? num(values['max-usd']) : undefined };

    out(bannerLines(t, { version: version() }).join('\n'));
    out(`  ${t.bold('ci')} ${t.mute(`· ${urls.length} page${urls.length === 1 ? '' : 's'} · ${triage === 'cascade' ? 'Jev → Claude → human' : triage === 'claude' ? 'Claude only' : 'rules only'}${values.tunnel ? ' · + click-through' : ''}`)}\n`);

    const pages = [];
    for (const [i, url] of urls.entries()) {
      const label = `page-${String(i + 1).padStart(2, '0')}`;
      const runs = [await dig({ url, name: label, triage, ...shared }, { bus: new EventBus() })];
      if (values.tunnel && runs[0].status !== 'not_run') runs.push(await tunnel({ url, name: `${label}-flow`, max: num(values.max, 12), allowOrigins: values['allow-origin'] || [], ...shared }, { bus: new EventBus() }));
      for (const r of runs) copyEvidence(r, path.join(evidenceDir, path.basename(r.runDir)));
      const exitCode = worst(runs.map((r) => r.exitCode));
      const distinct = runs.reduce((n, r) => n + (r.counted ? r.counted.length : 0), 0);
      const totalMs = runs.reduce((n, r) => n + (r.summary?.totalMs || 0), 0), totalUsd = runs.reduce((n, r) => n + (r.summary?.totalUsd || 0), 0);
      pages.push({ url, exitCode, status: exitCode === EXIT.NOT_RUN ? 'not_run' : exitCode === EXIT.DEFECTS ? 'defects' : 'pass', findings: distinct, problem: runs.find((r) => r.problem)?.problem || null, totalMs, totalUsd, runs: runs.map((r) => ({ kind: r.coverage ? 'tunnel' : 'dig', runId: r.runId, status: r.status, findings: r.counted?.length ?? 0, byRule: r.byRule })) });
      const g = exitCode === EXIT.PASS ? t.pass(t.sym.ok) : exitCode === EXIT.DEFECTS ? t.fail(t.sym.bad) : t.warn(t.sym.warn);
      out(`  ${g} ${padEnd(truncate(url, 58), 59)} ${exitCode === EXIT.PASS ? t.pass('clean') : exitCode === EXIT.DEFECTS ? t.fail(`${distinct} defect${distinct === 1 ? '' : 's'}`) : t.warn('NOT RUN')}  ${t.mute(`${fmtMs(totalMs)} · ${fmtUsd(totalUsd)}`)}`);
      if (exitCode === EXIT.NOT_RUN && pages.at(-1).problem) out(`      ${t.mute(truncate(pages.at(-1).problem, 90))}`);
    }

    const exitCode = worst(pages.map((p) => p.exitCode));
    const summary = { tool: stamp(P.root), evidenceId: id, exitCode, verdict: exitCode === 0 ? 'pass' : exitCode === 1 ? 'defects' : 'not_run', rule: 'NOT_RUN is a failure. Exit 0 only when every page was tested and is clean.', triage, pages,
      totals: { pages: pages.length, clean: pages.filter((p) => p.exitCode === 0).length, withDefects: pages.filter((p) => p.exitCode === 1).length, notRun: pages.filter((p) => p.exitCode === 2).length, findings: pages.reduce((n, p) => n + p.findings, 0), totalMs: pages.reduce((n, p) => n + p.totalMs, 0), totalUsd: pages.reduce((n, p) => n + p.totalUsd, 0) } };
    fs.writeFileSync(path.join(evidenceDir, 'summary.json'), JSON.stringify(summary, null, 2));
    if (json) process.stdout.write(JSON.stringify(summary) + '\n');
    else {
      const paint = exitCode === 0 ? t.pass : exitCode === 1 ? t.fail : t.warn;
      out(`\n  ${paint(t.bold(exitCode === 0 ? 'SURFACED · all pages clean' : exitCode === 1 ? `NUGGETS FOUND · ${summary.totals.findings} defects on ${summary.totals.withDefects} page${summary.totals.withDefects === 1 ? '' : 's'}` : `CAVE-IN · ${summary.totals.notRun} page${summary.totals.notRun === 1 ? '' : 's'} not tested (this is a failure)`))}`);
      out(`  ${t.mute(`exit ${exitCode} · ${fmtMs(summary.totals.totalMs)} · ${fmtUsd(summary.totals.totalUsd)} · evidence: ${evidenceDir}`)}\n`);
    }
    return exitCode;
  },
};
