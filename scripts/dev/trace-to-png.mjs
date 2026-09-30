// Dev tool: render what the terminal showed for a recorded run as PNG images (for the README, PRs, slides).
// Feeds the run's real trace.jsonl through the same reducer and view the live terminal uses, then screenshots it.
// Usage: node scripts/dev/trace-to-png.mjs <run-folder|trace.jsonl> [--out docs/assets] [--name dig]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { P } from '../../src/core/paths.mjs';
import { readTrace } from '../../src/core/events.mjs';
import { createState, reduce } from '../../src/ui/state.mjs';
import { liveLines, verdictLines } from '../../src/ui/terminal/view.mjs';
import { makeTheme } from '../../src/ui/terminal/theme.mjs';
import { launchBrowser } from '../../src/engine/browser.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', default: path.join(P.root, 'docs/assets') }, name: { type: 'string', default: 'terminal' }, cols: { type: 'string', default: '100' } } });
if (!positionals[0]) { console.error('usage: trace-to-png <run-folder|trace.jsonl> [--out dir] [--name label]'); process.exit(64); }
const file = fs.statSync(positionals[0]).isDirectory() ? path.join(positionals[0], 'trace.jsonl') : positionals[0];
const pricing = JSON.parse(fs.readFileSync(path.join(P.config, 'pricing.json'), 'utf8'));
const t = makeTheme({ color: true, unicode: true });
const cols = Number(values.cols);

let state = createState({ pricing });
for (const e of readTrace(file)) state = reduce(state, e);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function ansiToHtml(lines) {
  return lines.map((l) => {
    let out = '', fg = null, bg = null, bold = false;
    for (const p of l.split(/(\x1b\[[0-9;]*m)/)) {
      const m = p.match(/^\x1b\[([0-9;]*)m$/);
      if (!m) { if (p) out += `<span style="${fg ? `color:${fg};` : ''}${bg ? `background:${bg};` : ''}${bold ? 'font-weight:700;' : ''}">${esc(p)}</span>`; continue; }
      const c = m[1].split(';').map(Number);
      if (c[0] === 38 && c[1] === 2) fg = `rgb(${c[2]},${c[3]},${c[4]})`; else if (c[0] === 48 && c[1] === 2) bg = `rgb(${c[2]},${c[3]},${c[4]})`;
      else if (c[0] === 39) fg = null; else if (c[0] === 49) bg = null; else if (c[0] === 0) { fg = bg = null; bold = false; } else if (c[0] === 1) bold = true; else if (c[0] === 22) bold = false;
    }
    return `<div class="l">${out || '&nbsp;'}</div>`;
  }).join('');
}

const frames = { live: liveLines(state, t, { cols, rows: 50, frame: 0, now: state.end?.totalMs }), card: verdictLines(state, t, { cols }) };
fs.mkdirSync(values.out, { recursive: true });
const browser = await launchBrowser();
for (const [name, lines] of Object.entries(frames)) {
  const page = await browser.newPage({ viewport: { width: cols * 8 + 60, height: Math.max(160, lines.length * 15 + 36) }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0;background:#0b0d10"><pre style="margin:0;padding:14px 18px;color:#E6E6E6;font:13px/1.1 'Cascadia Mono',Consolas,monospace">${ansiToHtml(lines)}</pre><style>.l{white-space:pre;height:15px}</style></body></html>`);
  const out = path.join(values.out, `${values.name}-${name}.png`);
  await page.screenshot({ path: out }); await page.close();
  console.log('wrote', path.relative(P.root, out));
}
await browser.close();
