import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventBus, traceTo, readTrace, nullBus } from '../../src/core/events.mjs';

test('bus delivers events in order with type and a monotonic t', () => {
  const bus = new EventBus(); const seen = [];
  bus.on((e) => seen.push(e));
  bus.emit('a', { x: 1 }); bus.emit('b');
  assert.deepEqual(seen.map((e) => e.type), ['a', 'b']);
  assert.equal(seen[0].x, 1);
  assert.ok(seen[1].t >= seen[0].t);
});

test('a broken listener never breaks the run or the other listeners', () => {
  const bus = new EventBus(); const seen = [];
  bus.on(() => { throw new Error('display crashed'); });
  bus.on((e) => seen.push(e.type));
  assert.doesNotThrow(() => bus.emit('a'));
  assert.deepEqual(seen, ['a']);
});

test('a late subscriber can replay history (the overlay attaches after run.start)', () => {
  const bus = new EventBus(); bus.emit('run.start', { url: 'u' });
  const seen = []; bus.on((e) => seen.push(e.type), { replay: true }); bus.emit('page.loaded');
  assert.deepEqual(seen, ['run.start', 'page.loaded']);
  const late = []; bus.on((e) => late.push(e.type)); bus.emit('x');
  assert.deepEqual(late, ['x'], 'without replay only new events arrive');
});

test('unsubscribe stops delivery', () => {
  const bus = new EventBus(); let n = 0; const off = bus.on(() => n++);
  bus.emit('a'); off(); bus.emit('b');
  assert.equal(n, 1);
});

test('trace file round-trips and skips a torn last line', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trace-')), 'trace.jsonl');
  const bus = new EventBus(); traceTo(bus, file);
  bus.emit('run.start', { url: 'u' }); bus.emit('finding', { rule: 'contrast' });
  fs.appendFileSync(file, '{"type":"torn');
  const back = readTrace(file);
  assert.deepEqual(back.map((e) => e.type), ['run.start', 'finding']);
});

test('nullBus accepts everything and remembers nothing', () => {
  assert.equal(nullBus.emit('a'), null);
  assert.equal(typeof nullBus.on(() => {}), 'function');
});
