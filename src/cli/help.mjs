import { commands } from './commands/index.mjs';
import { detectTheme, bannerLines, version } from '../ui/terminal/index.mjs';

const t = () => detectTheme(process.stdout);

export function help() {
  const th = t();
  const w = Math.max(...commands.map((c) => c.name.length));
  return [
    ...bannerLines(th, { version: version() }),
    `  ${th.bold('Usage')}  mole <command> [options]`,
    '',
    `  ${th.bold('Commands')}`,
    ...commands.map((c) => `    ${th.brand(c.name.padEnd(w + 2))}${c.summary}`),
    '',
    `  ${th.bold('Exit codes')}  0 pass · 1 defects found · 2 not run (a failure, never a pass) · 64 bad usage`,
    `  ${th.bold('More')}        mole <command> --help`,
    '',
  ].join('\n');
}

export function commandHelp(cmd) {
  const th = t();
  const opts = Object.entries(cmd.options || {});
  const label = ([k, o]) => `--${k}${o.short ? `, -${o.short}` : ''}${o.type === 'string' ? ' <v>' : ''}`;
  const w = Math.max(...opts.map((e) => label(e).length), 0);
  return [
    '', `  ${th.brand(th.bold('mole ' + cmd.name))}  ${cmd.summary}`, '', `  ${th.bold('Usage')}  ${cmd.usage}`, '',
    `  ${th.bold('Options')}`,
    ...opts.map((e) => `    ${th.mute(label(e).padEnd(w + 2))}${e[1].description || ''}${e[1].default != null ? th.faint(` (default ${e[1].default})`) : ''}`),
    '',
  ].join('\n');
}
