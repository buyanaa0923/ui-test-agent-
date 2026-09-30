// The MCP tool catalogue: each tool is { name, description, inputSchema, annotations, run(args, { onEvent }) -> { text, data, isError } }.
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../core/paths.mjs';
import { EventBus } from '../core/events.mjs';
import { dig } from '../engine/dig.mjs';
import { tunnel } from '../engine/tunnel.mjs';
import { runDoctor } from '../engine/doctor.mjs';
import { summarize, toText } from './format.mjs';
import { resolveTriage } from '../core/triage.mjs';

const str = (d) => ({ type: 'string', description: d });
const common = {
  storageState: str('Playwright storageState file for pages behind login (a test account, kept outside the repo)'),
  ssoButton: str("Regex for the app's own sign-in button, clicked after each load"),
};

const triageFrom = (model) => resolveTriage({ 'no-model': model === 'none', judge: model === 'claude', cascade: model === 'cascade' });

async function runEngine(engine, kind, opts, onEvent) {
  const bus = new EventBus();
  bus.on((e) => onEvent?.(e));
  const r = await engine(opts, { bus });
  const data = summarize(kind, r);
  return { text: toText(data), data, isError: r.status === 'not_run' };
}

export const tools = [
  {
    name: 'mole_dig',
    description: 'Scan one page for design-system defects (contrast, font, sizing, labels, overflow, radius, raw colours) in light and dark mode, judged by a Jev -> Claude -> human ladder. Returns the distinct defects with severity, the element, the measurement, and who confirmed each. Read-only against the app. Use after changing UI, or to check a page before shipping.',
    inputSchema: {
      type: 'object', required: ['url'],
      properties: { url: str('Page URL, e.g. http://localhost:5200/dashboard'), modes: { type: 'array', items: { type: 'string', enum: ['light', 'dark'] }, description: 'Colour modes to check (default both)' }, model: { type: 'string', enum: ['auto', 'none', 'cascade', 'claude'], description: 'auto (default): Jev->Claude when keys are set, else rules only; none: rules only, free' }, ...common },
    },
    annotations: { title: 'Dig for UI defects', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: (a, ctx) => runEngine(dig, 'dig', { url: a.url, modes: a.modes?.length ? a.modes : ['light', 'dark'], name: 'mcp-dig', triage: triageFrom(a.model), storageState: a.storageState || process.env.UTA_STORAGE_STATE || null, ssoButton: a.ssoButton || process.env.UTA_SSO_BUTTON || null }, ctx.onEvent),
  },
  {
    name: 'mole_tunnel',
    description: "Click through a page's interactive controls one by one and report dead buttons, JS errors and failed requests. A safety screen (Jev then Claude) skips anything that could delete data, move money or log out; nothing is typed or submitted. Use to check that a page's controls actually work.",
    inputSchema: {
      type: 'object', required: ['url'],
      properties: { url: str('Page URL'), max: { type: 'integer', minimum: 1, maximum: 60, description: 'Maximum clicks (default 12)' }, picker: { type: 'string', enum: ['heuristic', 'jev'], description: 'How the next control is chosen (default heuristic, free)' }, riskScreen: { type: 'boolean', description: 'Force the safety screen on (always on with picker jev)' }, allowOrigins: { type: 'array', items: { type: 'string' }, description: 'Other origins the page legitimately loads from (micro-frontends)' }, ...common },
    },
    annotations: { title: 'Tunnel through controls', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (a, ctx) => runEngine(tunnel, 'tunnel', { url: a.url, max: a.max || 12, name: 'mcp-flow', picker: a.picker || 'heuristic', riskScreen: !!a.riskScreen, allowOrigins: a.allowOrigins || [], storageState: a.storageState || process.env.UTA_STORAGE_STATE || null, ssoButton: a.ssoButton || process.env.UTA_SSO_BUTTON || null }, ctx.onEvent),
  },
  {
    name: 'mole_doctor',
    description: 'Check that Mole can run on this machine: Node, browser, design tokens, Jev and Claude keys, network. Returns what is missing and the exact fix.',
    inputSchema: { type: 'object', properties: { url: str('Also check that this app URL is reachable'), live: { type: 'boolean', description: 'Also make one real Jev and one real Claude call (about $0.001)' } } },
    annotations: { title: 'Check setup', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(a) {
      const r = await runDoctor({ live: !!a.live, url: a.url || null });
      const text = [`**${r.summary}**`, ...r.results.map((x) => `${x.ok === true ? 'OK  ' : x.ok === 'warn' ? 'WARN' : 'FAIL'} ${x.name}${x.detail ? ` - ${x.detail}` : ''}${x.ok !== true && x.fix ? `\n     fix: ${x.fix}` : ''}`)].join('\n');
      return { text, data: r, isError: !r.ready };
    },
  },
  {
    name: 'mole_report',
    description: 'Re-read the result of a previous Mole run (latest by default): verdict, defects, coverage, cost and where the screenshots are.',
    inputSchema: { type: 'object', properties: { run: str('Run folder name under runs/, or "latest" (default)') } },
    annotations: { title: 'Read a previous run', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a) {
      if (!fs.existsSync(P.runs)) return { text: 'No runs yet.', data: null, isError: true };
      const dirs = fs.readdirSync(P.runs, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(P.runs, d.name, 'report.json'))).map((d) => d.name).sort();
      const name = !a.run || a.run === 'latest' ? dirs.at(-1) : a.run;
      const file = name && path.join(P.runs, path.basename(name), 'report.json'); // basename: never read outside runs/
      if (!file || !fs.existsSync(file)) return { text: `No report found for "${a.run || 'latest'}".`, data: null, isError: true };
      const rep = JSON.parse(fs.readFileSync(file, 'utf8'));
      const findings = rep.violations || [];
      const status = rep.status === 'not_run' ? 'not_run' : (rep.outcome?.status || (findings.length ? 'defects' : 'pass'));
      const data = summarize(rep.kind === 'flow' ? 'tunnel' : 'dig', { url: rep.url, status, exitCode: status === 'pass' ? 0 : status === 'defects' ? 1 : 2, problem: rep.problem, findings, coverage: rep.coverage, runDir: path.dirname(file) });
      return { text: toText(data), data, isError: status === 'not_run' };
    },
  },
];

export const byName = new Map(tools.map((t) => [t.name, t]));
