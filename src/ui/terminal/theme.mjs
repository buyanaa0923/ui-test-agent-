// Colours, symbols and text measuring for the terminal UI. Everything degrades: NO_COLOR / non-TTY -> plain text,
// MOLE_ASCII=1 -> ASCII symbols. No dependencies.

export const PALETTE = {
  brand: '#FFA030',   // dirt orange, from the mole sprite
  fur: '#C08035',
  ink: '#E6E6E6',
  mute: '#8A8F98',
  faint: '#4A4F58',
  pass: '#4ADE80',
  fail: '#F87171',
  warn: '#FBBF24',
  rule: '#A3A8B4',    // deterministic rules
  jev: '#2DD4BF',     // Jev
  claude: '#C084FC',  // Claude
  human: '#FBBF24',   // needs a person
  high: '#F87171', medium: '#FBBF24', low: '#60A5FA',
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const ASCII_MAP = { '·': '|', '→': '->', '≥': '>=', '–': '-', '…': '~', '˙': '.', '─': '-', '│': '|', '╭': '+', '╮': '+', '╰': '+', '╯': '+' };

export function makeTheme({ color = true, unicode = true } = {}) {
  const paint = (h, s) => (color ? `\x1b[38;2;${hex(h).join(';')}m${s}\x1b[39m` : String(s));
  const t = {
    color, unicode,
    // Unicode punctuation -> ASCII when the terminal (or --ascii) cannot show it. Apply BEFORE measuring widths.
    fit: (s) => (unicode ? String(s) : String(s).replace(/[·→≥–…˙─│╭╮╰╯]/g, (c) => ASCII_MAP[c])),
    fg: paint,
    bold: (s) => (color ? `\x1b[1m${s}\x1b[22m` : String(s)),
    dim: (s) => (color ? `\x1b[2m${s}\x1b[22m` : String(s)),
    bg: (h, s) => (color ? `\x1b[48;2;${hex(h).join(';')}m${s}\x1b[49m` : String(s)),
    // Role colours
    brand: (s) => paint(PALETTE.brand, s), mute: (s) => paint(PALETTE.mute, s), faint: (s) => paint(PALETTE.faint, s),
    pass: (s) => paint(PALETTE.pass, s), fail: (s) => paint(PALETTE.fail, s), warn: (s) => paint(PALETTE.warn, s),
    by: (who, s) => paint(PALETTE[who] || PALETTE.ink, s),
    sev: (sev, s) => paint(PALETTE[sev] || PALETTE.ink, s),
    sym: unicode
      ? { ok: '✔', bad: '✖', warn: '⚠', dot: '●', ring: '○', arrow: '›', dig: '⛏', bolt: '⚡', clock: '◷', up: '↑', right: '→', bar: '━', barOff: '─', hr: '─', spin: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], spark: '▁▂▃▄▅▆▇█', half: '▀' }
      : { ok: 'v', bad: 'x', warn: '!', dot: '*', ring: 'o', arrow: '>', dig: '>', bolt: '~', clock: '@', up: '^', right: '->', bar: '#', barOff: '.', hr: '-', spin: ['|', '/', '-', '\\'], spark: '._-~=+*#', half: '#' },
  };
  return t;
}

// The theme a stream should get by default.
export function detectTheme(stream = process.stdout, env = process.env) {
  const forced = env.FORCE_COLOR && env.FORCE_COLOR !== '0';
  const color = !env.NO_COLOR && (forced || !!stream.isTTY) && env.TERM !== 'dumb';
  const unicode = !env.MOLE_ASCII && !(process.platform === 'win32' && !env.WT_SESSION && !env.TERM_PROGRAM && !env.ConEmuANSI && !forced && !env.MOLE_UNICODE);
  return makeTheme({ color, unicode });
}

// Visible width of a string (ANSI escapes removed; wide/emoji characters counted as 2 where common).
const ANSI = /\x1b\[[0-9;]*m/g;
export const strip = (s) => String(s).replace(ANSI, '');
export const width = (s) => { let w = 0; for (const ch of strip(s)) { const c = ch.codePointAt(0); w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0x1f300 && c <= 0x1faff))) ? 2 : 1; } return w; };
export const padEnd = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));
export const padStart = (s, n) => ' '.repeat(Math.max(0, n - width(s))) + s;
export function truncate(s, n) {
  s = String(s);
  if (width(s) <= n) return s;
  let out = '', w = 0;
  for (const ch of strip(s)) { const cw = width(ch); if (w + cw > n - 1) break; out += ch; w += cw; }
  return out + '…';
}

export const fmtMs = (ms) => (ms == null ? '–' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`);
export const fmtUsd = (u) => (u == null ? '–' : u === 0 ? '$0' : u < 0.01 ? `$${u.toFixed(4)}` : `$${u.toFixed(3)}`);

export function bar(theme, frac, w, color = 'brand') {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  const on = Math.round(f * w);
  return theme.by(color, theme.sym.bar.repeat(on)) + theme.faint(theme.sym.barOff.repeat(w - on));
}

export function spark(theme, values, w = 12) {
  const v = values.slice(-w);
  if (!v.length) return '';
  const max = Math.max(...v), min = Math.min(...v), rng = max - min || 1, chars = theme.sym.spark;
  return v.map((x) => chars[Math.min(chars.length - 1, Math.floor(((x - min) / rng) * (chars.length - 1)))]).join('');
}
