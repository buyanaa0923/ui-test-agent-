// Dev tool: turn assets/brand/mole.png (pixel art on a black background) into src/ui/terminal/mole.sprite.json,
// the grid of colours the terminal renders with half-block characters. No dependencies: a minimal PNG decoder
// (8-bit RGBA, non-interlaced, which is what the source file is) on top of node:zlib.
// Usage: node tools/build-sprite.mjs [in.png] [out.json]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from '../../src/core/paths.mjs';

const root = ROOT;
const src = path.resolve(process.argv[2] || path.join(root, 'assets/brand/mole.png'));
const out = path.resolve(process.argv[3] || path.join(root, 'src/ui/terminal/mole.sprite.json'));

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let w = 0, h = 0, idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected 8-bit RGBA, non-interlaced'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      px[o + x] = (line[x] + pred) & 255;
    }
  }
  return { w, h, px };
}

const { w, h, px } = decodePng(fs.readFileSync(src));
const at = (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
const isBg = ([r, g, b, a]) => a < 16 || r + g + b < 12;

// Background = near-black pixels reachable from the border (so black pupils inside the mole survive).
const bg = new Uint8Array(w * h), stack = [];
for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= w || y >= h || bg[y * w + x] || !isBg(at(x, y))) continue;
  bg[y * w + x] = 1; stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

let x0 = w, y0 = h, x1 = 0, y1 = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!bg[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }

// Pixel-art grid: the source is a small sprite scaled up by an integer. Find that scale from run lengths.
const runs = new Map();
for (let y = y0; y <= y1; y += 7) { let run = 1; for (let x = x0 + 1; x <= x1; x++) { const same = at(x, y).join() === at(x - 1, y).join(); if (same) run++; else { runs.set(run, (runs.get(run) || 0) + 1); run = 1; } } }
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
let unit = 0; for (const [r, n] of runs) if (n > 20) unit = gcd(unit, r);
if (unit < 2) unit = 1;

const cols = Math.ceil((x1 - x0 + 1) / unit), rows = Math.ceil((y1 - y0 + 1) / unit);
const grid = [];
for (let r = 0; r < rows; r++) {
  const row = [];
  for (let c = 0; c < cols; c++) {
    const x = x0 + c * unit + (unit >> 1), y = y0 + r * unit + (unit >> 1);
    row.push(x > x1 || y > y1 || bg[y * w + x] ? null : '#' + at(x, y).slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''));
  }
  grid.push(row);
}
const palette = [...new Set(grid.flat().filter(Boolean))];
fs.mkdirSync(path.dirname(out), { recursive: true });
// Rows of palette indices ('.' = transparent), one string per row: small, diffable, hand-editable.
const key = (c) => (c == null ? '.' : String.fromCharCode(97 + palette.indexOf(c)));
fs.writeFileSync(out, JSON.stringify({ width: cols, height: rows, palette, rows: grid.map((r) => r.map(key).join('')) }, null, 1));
console.log(`sprite ${cols}x${rows} (source unit ${unit}px, ${palette.length} colours) -> ${path.relative(root, out)}`);
