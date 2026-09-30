import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/core/events.mjs';
import { attachTerminal } from '../../src/ui/terminal/index.mjs';
import { strip } from '../../src/ui/terminal/theme.mjs';

const fakeStream = ({ tty = true, columns = 100, rows = 40 } = {}) => { const chunks = []; return { isTTY: tty, columns, rows, write: (s) => { chunks.push(String(s)); return true; }, chunks, text: () => chunks.join('') }; };
const script = (bus, { status = 'defects', exitCode = 1 } = {}) => {
  bus.emit('run.start', { command: 'dig', url: 'http://x', modes: ['light', 'dark'], triage: 'none', runId: 'r', runDir: '/r' });
  bus.emit('page.loaded', { elements: 20, ms: 500 });
  bus.emit('mode.start', { mode: 'light' });
  bus.emit('finding', { key: 'a', rule: 'contrast', severity: 'high', element: 'p#hint', detail: 'contrast 2.56:1, needs 4.5:1 (light mode)', mode: 'light' });
  bus.emit('mode.done', { mode: 'light', elements: 20, findings: 1, checked: [] });
  bus.emit('mode.done', { mode: 'dark', elements: 20, findings: 0, checked: [] });
  bus.emit('run.end', { status, exitCode, totalMs: 2100, totalUsd: 0, findings: status === 'defects' ? 1 : 0 });
};

test('live renderer redraws in place, ends with the verdict card, and always restores the cursor', () => {
  const bus = new EventBus(), out = fakeStream();
  const term = attachTerminal(bus, { mode: 'live', stream: out, color: false });
  assert.equal(term.mode, 'live');
  assert.ok(out.chunks[0].includes('\x1b[?25l'), 'cursor hidden while drawing');
  script(bus);
  const all = out.text();
  assert.ok(all.includes('\x1b[2K'), 'lines are cleared before redraw');
  assert.match(all, /\x1b\[\d+A/, 'cursor moves up to redraw in place');
  assert.match(strip(all), /NUGGETS FOUND/); assert.match(strip(all), /contrast/);
  assert.ok(out.text().trimEnd().endsWith('\x1b[?25h') || out.chunks.at(-1).includes('\x1b[?25h'), 'cursor shown again at the end');
  const before = out.chunks.length; bus.emit('note', { message: 'late' }); term.stop();
  assert.equal(out.chunks.length, before, 'nothing is drawn after the run ended');
});

test('live panel never exceeds the terminal height', () => {
  const bus = new EventBus(), out = fakeStream({ rows: 12 });
  attachTerminal(bus, { mode: 'live', stream: out, color: false });
  bus.emit('run.start', { command: 'dig', url: 'http://x', modes: ['light', 'dark'], triage: 'none' });
  for (let i = 0; i < 30; i++) bus.emit('finding', { key: `k${i}`, rule: `rule-${i}`, severity: 'low', element: `el${i}`, detail: 'd', mode: 'light' });
  const lastFrame = out.chunks.at(-1);
  assert.ok((lastFrame.match(/\n/g) || []).length <= 11, `frame is ${(lastFrame.match(/\n/g) || []).length} lines in a 12-row terminal`);
});

test('plain renderer: one readable line per event, no cursor codes, same verdict card', () => {
  const bus = new EventBus(), out = fakeStream({ tty: false });
  const term = attachTerminal(bus, { mode: 'auto', stream: out, color: false });
  assert.equal(term.mode, 'plain', 'a pipe gets plain output');
  script(bus);
  const text = out.text();
  assert.doesNotMatch(text, /\x1b/);
  for (const w of ['MOLE dig http://x', 'loaded 20 elements', 'light: 20 checked, 1 nugget', '[high] contrast', 'NUGGETS FOUND', 'exit 1']) assert.ok(text.includes(w), `missing "${w}"`);
});

test('plain renderer prints a finding that repeats in dark mode only once', () => {
  const bus = new EventBus(), out = fakeStream({ tty: false });
  attachTerminal(bus, { mode: 'plain', stream: out, color: false });
  const f = (mode) => bus.emit('finding', { key: `a${mode}`, rule: 'control-unlabeled', severity: 'high', element: 'select#a', detail: 'no label', mode });
  bus.emit('run.start', { command: 'dig', url: 'u', modes: ['light', 'dark'], triage: 'none' }); f('light'); f('dark');
  assert.equal((out.text().match(/control-unlabeled/g) || []).length, 1);
});

test('json mode: exactly one JSON object per line and nothing else on stdout', () => {
  const bus = new EventBus(), out = fakeStream({ tty: false });
  attachTerminal(bus, { mode: 'json', stream: out });
  script(bus);
  const lines = out.text().trim().split('\n');
  assert.equal(lines.length, bus.history.length);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.equal(parsed[0].type, 'run.start'); assert.equal(parsed.at(-1).type, 'run.end'); assert.equal(parsed.at(-1).exitCode, 1);
});

test('NOT RUN in plain mode is loud and ends without a pass card', () => {
  const bus = new EventBus(), out = fakeStream({ tty: false });
  attachTerminal(bus, { mode: 'plain', stream: out, color: false });
  bus.emit('run.start', { command: 'dig', url: 'u', modes: ['light'], triage: 'none' });
  bus.emit('not_run', { problem: 'u needs login' });
  bus.emit('run.end', { status: 'not_run', exitCode: 2, totalMs: 10, totalUsd: 0 });
  const t = out.text();
  assert.match(t, /NOT RUN/); assert.match(t, /needs login/); assert.doesNotMatch(t, /SURFACED|CLEAN/);
});
