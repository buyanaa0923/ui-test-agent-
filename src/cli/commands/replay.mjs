import fs from 'node:fs';
import path from 'node:path';
import { P } from '../../core/paths.mjs';
import { EventBus, readTrace } from '../../core/events.mjs';
import { attachTerminal } from '../../ui/terminal/index.mjs';
import { outputOptions, terminalOptions, num } from '../options.mjs';
import { NotRunError } from '../../core/errors.mjs';

// A run is given as a folder, a trace file, or "latest".
function resolveTrace(arg) {
  if (!arg || arg === 'latest') {
    const dirs = fs.existsSync(P.runs) ? fs.readdirSync(P.runs, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(P.runs, d.name, 'trace.jsonl'))) : [];
    if (!dirs.length) throw new NotRunError('no recorded runs with a trace.jsonl in runs/');
    return path.join(P.runs, dirs.map((d) => d.name).sort().at(-1), 'trace.jsonl');
  }
  const p = path.resolve(arg);
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'trace.jsonl') : fs.existsSync(p) ? p : path.join(P.runs, arg, 'trace.jsonl');
  if (!fs.existsSync(file)) throw new NotRunError(`no trace found for "${arg}"`);
  return file;
}

export default {
  name: 'replay',
  summary: 'Replay a recorded run in the terminal (no browser, no model calls)',
  usage: 'mole replay [run-folder|trace.jsonl|latest] [--speed 4]',
  positionals: 0,
  options: {
    speed: { type: 'string', default: '1', description: 'playback speed multiplier (0 = instant)' },
    ...outputOptions,
  },
  async run({ values, positionals }) {
    const events = readTrace(resolveTrace(positionals[0]));
    const speed = num(values.speed, 1);
    const bus = new EventBus();
    const term = attachTerminal(bus, terminalOptions(values));
    let prev = 0;
    for (const e of events) {
      const { type, t, ...payload } = e;
      if (speed > 0 && t > prev) await new Promise((r) => setTimeout(r, Math.min((t - prev) / speed, 1500)));
      prev = t;
      bus.emit(type, { ...payload, replayT: t });
    }
    term.stop();
    return events.find((e) => e.type === 'run.end')?.exitCode ?? 0;
  },
};
