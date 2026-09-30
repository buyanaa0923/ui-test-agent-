// The mole, drawn in the terminal with half-block characters: each character cell shows two vertically stacked
// pixels (top = foreground colour of "▀", bottom = background colour). Source: mole.sprite.json, built from
// assets/brand/mole.png by scripts/dev/build-sprite.mjs.
import { createRequire } from 'node:module';
const sprite = createRequire(import.meta.url)('./mole.sprite.json');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Sprite as a colour grid; `shrink` averages shrink x shrink blocks (2 -> half size).
function grid(shrink = 1) {
  const px = sprite.rows.map((r) => [...r].map((ch) => (ch === '.' ? null : hex(sprite.palette[ch.charCodeAt(0) - 97]))));
  if (shrink === 1) return px;
  const out = [];
  for (let y = 0; y < px.length; y += shrink) {
    const row = [];
    for (let x = 0; x < px[0].length; x += shrink) {
      const cells = [];
      for (let dy = 0; dy < shrink; dy++) for (let dx = 0; dx < shrink; dx++) { const c = px[y + dy]?.[x + dx]; if (c) cells.push(c); }
      row.push(cells.length * 2 >= shrink * shrink ? [0, 1, 2].map((i) => Math.round(cells.reduce((s, c) => s + c[i], 0) / cells.length)) : null);
    }
    out.push(row);
  }
  return out;
}

const fg = (c) => `\x1b[38;2;${c.join(';')}m`;
const bg = (c) => `\x1b[48;2;${c.join(';')}m`;
const RESET = '\x1b[0m';

// Lines of text (each `cols` characters wide) for the sprite. Without colour support it falls back to a plain-text mole.
export function renderSprite({ shrink = 1, color = true } = {}) {
  if (!color) return ['  (o.o)  ', ' /|   |\\ ', '  \\___/  '];
  const g = grid(shrink);
  const lines = [];
  for (let y = 0; y < g.length; y += 2) {
    let line = '';
    for (let x = 0; x < g[0].length; x++) {
      const top = g[y][x], bot = g[y + 1]?.[x] ?? null;
      if (!top && !bot) line += ' ';
      else if (top && !bot) line += `${fg(top)}▀${RESET}`;
      else if (!top && bot) line += `${fg(bot)}▄${RESET}`;
      else line += `${fg(top)}${bg(bot)}▀${RESET}`;
    }
    lines.push(line.replace(/( +)$/g, ''));
  }
  return lines;
}

export const SPRITE_SIZE = { width: sprite.width, height: sprite.height };
