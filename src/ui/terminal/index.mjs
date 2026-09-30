// Terminal UI entry: pick the right renderer for where the output is going.
//   live  : redrawn in place (TTY)            plain : one line per event (CI, pipes, Claude Code's Bash tool)
//   json  : NDJSON events (machines)          quiet : nothing until the verdict card
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../../core/paths.mjs';
import { detectTheme, makeTheme } from './theme.mjs';
import { startLive } from './live.mjs';
import { startPlain, startJson } from './plain.mjs';
import { bannerLines } from './view.mjs';
import { version } from '../../core/version.mjs';

const pricing = () => { try { return JSON.parse(fs.readFileSync(path.join(P.config, 'pricing.json'), 'utf8')); } catch { return null; } };

export function attachTerminal(bus, { mode = 'auto', stream = process.stdout, ascii = false, color } = {}) {
  const base = detectTheme(stream);
  const theme = makeTheme({ color: color ?? base.color, unicode: ascii ? false : base.unicode });
  const chosen = mode === 'auto' ? (stream.isTTY && base.color !== false && process.env.TERM !== 'dumb' ? 'live' : 'plain') : mode;
  if (chosen === 'json') return { mode: 'json', theme, ...startJson(bus, { stream }) };
  if (chosen === 'live') return { mode: 'live', theme, ...startLive(bus, { stream, theme, pricing: pricing() }) };
  return { mode: 'plain', theme, ...startPlain(bus, { stream, theme, pricing: pricing() }) };
}

export { detectTheme, makeTheme, bannerLines, version };
