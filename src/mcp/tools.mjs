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
  watch: { type: 'boolean', description: "Open a real browser window on the developer's screen with the live Mole overlay while the run happens (slower: each step lingers so a person can follow). Default: the MOLE_WATCH setting, else off" },
  record: { type: 'boolean', description: 'Save a video of the run in its run folder (with watch, it shows the overlay at human pace)' },
};

// Watching means a visible browser, a paced run and the overlay attached; the injected loader keeps src/ui out of this layer.
const wantsWatch = (a) => (a.watch != null ? !!a.watch : /^(1|true|yes|on)$/i.test(process.env.MOLE_WATCH || ''));
async function watchOpts(a, ctx, pace) {
  if (!wantsWatch(a) || !ctx.overlay) return { opts: { headed: false, pace: 0 }, attach: null };
  return { opts: { headed: true, pace }, attach: await ctx.overlay() };
}

const triageFrom = (model) => resolveTriage({ 'no-model': model === 'none', judge: model === 'claude', cascade: model === 'cascade' });

async function runEngine(engine, kind, opts, ctx, pace) {
  const bus = new EventBus();
  bus.on((e) => ctx.onEvent?.(e));
  const w = await watchOpts(opts, ctx, pace);
  const r = await engine({ ...opts, ...w.opts, record: !!opts.record }, { bus, attach: w.attach });
  const data = summarize(kind, r);
  return { text: toText(data), data, isError: r.status === 'not_run' };
}

export const tools = [
  {
    name: 'mole_dig',
    description: "Scan one page against the project's design contract (its design.md, on top of Mole's modern-web best practices) in light and dark mode: contrast, touch-target size, type size / line height / line length, fonts, colours, radius, labels, overflow. Deterministic measurements, optionally judged by a Jev -> Claude -> human ladder. Returns the distinct defects with severity, the element, the measurement, the rule's source (WCAG, HIG, the design) and a fix hint. Read-only against the app. Use after changing UI, or to check a page before shipping.",
    inputSchema: {
      type: 'object', required: ['url'],
      properties: { url: str('Page URL, e.g. http://localhost:5200/dashboard'), design: str("Path to the project's design.md (the design contract). Default: DESIGN.md / design.md / .mole/design.md in the working directory, else Mole's built-in NetOS contract"), root: str("The project's source folder (absolute), so each defect comes back with the file:line to fix. Default: MOLE_SRC_ROOT, else the design.md's project, else the server's working directory"), platform: { type: 'string', enum: ['desktop', 'mobile'], description: "mobile = phone viewport, 44px touch targets, 16px body text, iOS input zoom. Default: the design's own platform, else desktop" }, modes: { type: 'array', items: { type: 'string', enum: ['light', 'dark'] }, description: 'Colour modes to check (default both)' }, model: { type: 'string', enum: ['auto', 'none', 'cascade', 'claude'], description: 'auto (default): Jev->Claude when keys are set, else rules only; none: rules only, free' }, ...common },
    },
    annotations: { title: 'Dig for UI defects', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: (a, ctx) => runEngine(dig, 'dig', { url: a.url, modes: a.modes?.length ? a.modes : ['light', 'dark'], name: 'mcp-dig', triage: triageFrom(a.model), design: a.design || null, platform: a.platform || null, root: a.root || null, storageState: a.storageState || process.env.UTA_STORAGE_STATE || null, ssoButton: a.ssoButton || process.env.UTA_SSO_BUTTON || null, watch: a.watch, record: a.record }, ctx, 900),
  },
  {
    name: 'mole_tunnel',
    description: "Click through a page's interactive controls one by one, follow the pages they lead to, open their dialogs / tabs / accordions / menus, run the mole_dig design checks on every page and dialog reached, and report design defects, dead buttons, JS errors, failed requests and links that land on a broken page (HTTP error, blank, not found, login wall). A safety screen (Jev then Claude) skips anything that could delete data, move money or log out; nothing is typed or submitted. Use to check that a page's controls actually work.",
    inputSchema: {
      type: 'object', required: ['url'],
      properties: { url: str('Page URL'), max: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum clicks across all pages (default 30)' }, depth: { type: 'integer', minimum: 0, maximum: 5, description: 'Follow the pages clicks reach, up to this many clicks from the start page (default 2; 0 = this page only)' }, maxPages: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum pages to explore (default 10)' }, stateDepth: { type: 'integer', minimum: 0, maximum: 4, description: 'Open dialogs, tabs, accordions and menus and test what is inside, up to this many clicks deep (default 2; 0 = off)' }, maxStates: { type: 'integer', minimum: 1, maximum: 30, description: 'Maximum dialogs / panels per page (default 6)' }, forms: { type: 'string', enum: ['off', 'fill', 'submit'], description: "off (default); fill: type obvious test data into each form and check it takes it, nothing is sent; submit: also send it and judge the answer. submit CREATES DATA in the app: only when the user asked for it, and only on a local dev host unless submitHosts names the host" }, submitHosts: { type: 'array', items: { type: 'string' }, description: 'Hosts other than local dev hosts where forms may be submitted (a test environment the user controls)' }, maxSubmits: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum submissions (default 5)' }, checkDesign: { type: 'boolean', description: 'Also run the mole_dig design checks on every page reached (default true)' }, design: str("Path to the project's design.md (as for mole_dig)"), root: str("The project's source folder (absolute), for file:line on design defects"), platform: { type: 'string', enum: ['desktop', 'mobile'], description: "Default: the design's own platform, else desktop" }, modes: { type: 'array', items: { type: 'string', enum: ['light', 'dark'] }, description: 'Colour modes for the design checks (default both)' }, model: { type: 'string', enum: ['auto', 'none', 'cascade', 'claude'], description: 'Judge for the design findings, as for mole_dig (default auto)' }, picker: { type: 'string', enum: ['heuristic', 'jev'], description: 'How the next control is chosen (default heuristic, free)' }, riskScreen: { type: 'boolean', description: 'Force the safety screen on (always on with picker jev)' }, allowOrigins: { type: 'array', items: { type: 'string' }, description: 'Other origins the page legitimately loads from (micro-frontends)' }, ...common },
    },
    annotations: { title: 'Tunnel through controls', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: (a, ctx) => runEngine(tunnel, 'tunnel', { url: a.url, max: a.max || 30, depth: a.depth ?? 2, maxPages: a.maxPages || 10, stateDepth: a.stateDepth ?? 2, maxStates: a.maxStates || 6, forms: a.forms || 'off', submitHosts: a.submitHosts || [], maxSubmits: a.maxSubmits || 5, checkDesign: a.checkDesign ?? true, design: a.design || null, root: a.root || null, platform: a.platform || null, modes: a.modes?.length ? a.modes : ['light', 'dark'], designTriage: triageFrom(a.model), name: 'mcp-flow', picker: a.picker || 'heuristic', riskScreen: !!a.riskScreen, allowOrigins: a.allowOrigins || [], storageState: a.storageState || process.env.UTA_STORAGE_STATE || null, ssoButton: a.ssoButton || process.env.UTA_SSO_BUTTON || null, watch: a.watch, record: a.record }, ctx, 500),
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
