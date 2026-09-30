// Live renderer for a TTY: redraws the panel in place ~10 times a second, so the spinner, timer and cost move
// even between events. Never throws into the run; restores the cursor on any exit path.
import { createState, reduce } from '../state.mjs';
import { liveLines, verdictLines } from './view.mjs';

export function startLive(bus, { stream = process.stdout, theme, pricing = null, fps = 10 } = {}) {
  let state = createState({ pricing });
  let frame = 0, drawn = 0, timer = null, stopped = false;

  const size = () => ({ cols: Math.max(40, Math.min(stream.columns || 100, 120)), rows: stream.rows || 40 });

  function draw() {
    if (stopped) return;
    const { cols, rows } = size();
    let lines = liveLines(state, theme, { cols, rows, frame, now: Date.now() - bus.startedAt });
    if (lines.length > rows - 1) lines = lines.slice(0, rows - 1); // never scroll the panel out of the terminal
    let buf = drawn ? `\x1b[${drawn}A\r` : '';
    for (const l of lines) buf += `\x1b[2K${l}\n`;
    if (lines.length < drawn) buf += '\x1b[J'; // the panel shrank: clear the leftover rows
    stream.write(buf);
    drawn = lines.length;
  }

  const off = bus.on((evt) => {
    state = reduce(state, evt);
    if (evt.type === 'run.end') finish();
  });
  const restore = () => stream.write('\x1b[?25h');
  const onExit = () => restore();
  process.once('exit', onExit);

  stream.write('\x1b[?25l');
  timer = setInterval(() => { frame++; draw(); }, Math.round(1000 / fps));
  timer.unref?.();
  draw();

  function finish() {
    if (stopped) return;
    draw();
    stopped = true;
    clearInterval(timer);
    stream.write(verdictLines(state, theme, { cols: size().cols }).join('\n') + '\n');
    restore();
    process.off('exit', onExit);
    off();
  }
  return { stop: finish, get state() { return state; } };
}
