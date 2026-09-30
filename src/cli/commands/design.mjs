// mole design: see and start the design contract that dig checks against.
//   mole design [show]   what Mole will enforce here: the resolved contract, where each value came from, which rules are on
//   mole design init     write a starter DESIGN.md (never overwrites)
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../../core/paths.mjs';
import { resolveContract, contractSummary } from '../../engine/contract.mjs';
import { activeRules } from '../../engine/design-checks.mjs';
import { detectTheme, bannerLines, version } from '../../ui/terminal/index.mjs';
import { outputOptions, designOptions } from '../options.mjs';

const list = (v) => (v == null ? null : Array.isArray(v) ? v.join(', ') : String(v));

function show(values, t, out) {
  const c = resolveContract({ design: values.design || null, platform: values.platform || null });
  if (values.json) { process.stdout.write(JSON.stringify({ ...contractSummary(c), contract: { ...c, prose: undefined }, rules: activeRules(c) }) + '\n'); return 0; }
  out(`  ${t.bold('design')} ${t.mute(`· ${c.name} · ${c.platform} · ${c.hash}`)}`);
  for (const s of contractSummary(c).sources) out(`  ${t.faint('from')} ${s}`);
  for (const n of c.notes) out(`  ${t.warn('note')} ${n}`);
  out();
  const rows = [
    ['fonts', list(c.fonts)], ['colors', c.colors ? `${c.colors.length} allowed` : null],
    ['type scale', list(c.type.scale)], ['smallest text', c.type.min && `${c.type.min}px`], ['body text', c.type.bodyMin && `${c.type.bodyMin}px+`],
    ['line height', c.type.lineHeightMin && `${c.type.lineHeightMin}x+`], ['line length', c.type.maxLineChars && `≤ ${c.type.maxLineChars} chars`],
    ['text sizes', c.type.maxSizes && `≤ ${c.type.maxSizes} per page`], ['targets', c.targets && `${c.targets}x${c.targets}px+`],
    ['buttons', list(c.buttons.heights)], ['radius', list(c.radii)], ['spacing', c.spacing && `${c.spacing}px grid`],
    ['contrast', `${c.contrast.normal}:1 text, ${c.contrast.large}:1 large`], ['ignored', c.ignore.length ? c.ignore.join('  ') : null],
  ];
  for (const [k, v] of rows) out(`  ${t.mute(k.padEnd(14))}${v == null ? t.faint('not set') : v}`);
  out();
  for (const r of activeRules(c)) {
    const name = r.rule.padEnd(24);
    out(`  ${r.on ? t.pass(t.sym.ok) : t.faint('-')} ${r.on ? name : t.faint(name)}${t.mute(`${r.tier.padEnd(9)} ${r.ref}`)}${r.severity ? t.warn(` [${r.severity}]`) : ''}`);
  }
  out(`\n  ${t.mute('Rules marked - are off: the contract gives them no value, or switches them off.')}\n`);
  return 0;
}

function init(values, out) {
  const file = path.resolve(values.out || 'DESIGN.md');
  if (fs.existsSync(file)) { process.stderr.write(`mole design init: ${file} already exists; not overwriting it\n`); return 64; }
  let text = fs.readFileSync(path.join(P.config, 'design-template.md'), 'utf8');
  if (values.extends) text = text.replace(/^extends: modern-web .*$/m, `extends: ${values.extends}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  resolveContract({ design: file }); // the template must itself be a valid contract
  out(`  wrote ${file}\n  next: fill in your values (or run /mole:design in Claude Code to draft them from the code), then \`mole design show\`\n`);
  return 0;
}

export default {
  name: 'design',
  summary: 'Show the design contract Mole checks against, or start a DESIGN.md',
  usage: 'mole design [show|init] [--design DESIGN.md] [--platform mobile]',
  positionals: 0,
  options: {
    ...designOptions,
    out: { type: 'string', description: 'init: where to write (default DESIGN.md)' },
    extends: { type: 'string', description: 'init: the pack to start from (modern-web or netos)' },
    ...outputOptions,
  },
  async run({ values, positionals }) {
    if (values['no-color']) process.env.NO_COLOR = '1';
    const t = detectTheme(process.stdout);
    const out = (s = '') => process.stdout.write(s + '\n');
    const sub = positionals[0] || 'show';
    if (!values.json) out(bannerLines(t, { version: version() }).join('\n'));
    if (sub === 'show') return show(values, t, out);
    if (sub === 'init') return init(values, out);
    process.stderr.write(`mole design: unknown subcommand "${sub}" (show, init)\n`);
    return 64;
  },
};
