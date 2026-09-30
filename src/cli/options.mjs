// Option definitions shared by commands, and the small helpers every command needs.
import '../core/env.mjs';

// Output options every command accepts.
export const outputOptions = {
  json: { type: 'boolean', description: 'machine output: one JSON event per line (NDJSON)' },
  plain: { type: 'boolean', description: 'no live redraw: one line per event (default when not a terminal)' },
  ascii: { type: 'boolean', description: 'ASCII symbols only' },
  'no-color': { type: 'boolean', description: 'no colour (also honours NO_COLOR)' },
};

// Options for commands that drive a browser.
export const browserOptions = {
  watch: { type: 'boolean', short: 'w', description: 'show the browser with the live mole overlay (real time)' },
  headed: { type: 'boolean', description: 'alias of --watch' },
  record: { type: 'boolean', description: 'record a video of the run (saved in the run folder)' },
  pace: { type: 'string', description: 'ms to linger on each step while watching (default: dig 900, tunnel 500; 0 = full speed)' },
  'storage-state': { type: 'string', description: 'Playwright storageState file for pages behind login (kept outside the repo)' },
  'sso-button': { type: 'string', description: "regex for the app's own sign-in button, clicked after each load" },
  'max-usd': { type: 'string', description: 'hard stop on model spend in USD (default BUDGET_USD or 1)' },
};

export function terminalOptions(values) {
  if (values['no-color']) process.env.NO_COLOR = '1';
  return { mode: values.json ? 'json' : values.plain ? 'plain' : 'auto', ascii: !!values.ascii };
}

export const wantsWatch = (v) => !!(v.watch || v.headed);
export const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

export { resolveTriage } from '../core/triage.mjs';

// Options for commands that check a page against a design contract.
export const designOptions = {
  design: { type: 'string', description: 'design contract (a design.md); default: DESIGN.md / design.md / .mole/design.md here, or MOLE_DESIGN, else the built-in NetOS contract' },
  src: { type: 'string', description: 'project source folder, to point each finding at its file:line (default: MOLE_SRC_ROOT, else the DESIGN.md project, else here); "none" to skip' },
  platform: { type: 'string', description: "desktop | mobile (phone viewport, touch-target and iOS rules); default: the design's own platform, else desktop" },
};

// --src -> the engine's root / locate options.
export const sourceOpts = (v) => (v.src === 'none' ? { locate: false } : { root: v.src || null });

export const modelOptions = {
  cascade: { type: 'boolean', description: 'judge findings with Jev, escalating the unsure ones to Claude (default when keys are set)' },
  judge: { type: 'boolean', description: 'judge findings with Claude only' },
  'no-model': { type: 'boolean', description: 'rules only, no model calls (free)' },
};

// Overlay is optional and only loaded when someone asks to watch: keeps headless runs lean.
export async function overlayAttach(values) {
  if (!wantsWatch(values)) return null;
  const { attachOverlay } = await import('../ui/overlay/index.mjs');
  return attachOverlay;
}
