import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, tmpDir } from '../helpers/cli.mjs';
import { startMock } from '../helpers/mock-typesafe.mjs';

// Runs go to a temp folder; the engine reads MOLE_RUNS_DIR when it is first imported.
const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { dig } = await import('../../src/engine/dig.mjs');
const { tunnel } = await import('../../src/engine/tunnel.mjs');
const { EventBus, readTrace } = await import('../../src/core/events.mjs');
const { resetBreaker } = await import('../../src/models/typesafe.mjs');

const types = (bus) => bus.history.map((e) => e.type);
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('dig on a page with seeded bugs: exit 1, ordered events, complete run folder, report keeps its schema', async () => {
  const bus = new EventBus();
  const r = await dig({ url: fixture('sample.html'), name: 't-sample' }, { bus });
  assert.equal(r.exitCode, 1); assert.equal(r.status, 'defects');
  const t = types(bus);
  assert.equal(t[0], 'run.start'); assert.equal(t.at(-1), 'run.end');
  assert.ok(t.indexOf('page.loaded') < t.indexOf('mode.start') && t.indexOf('mode.done') < t.indexOf('run.result') && t.indexOf('run.result') < t.indexOf('run.end'));
  assert.equal(t.filter((x) => x === 'mode.done').length, 2);
  assert.equal(t.filter((x) => x === 'finding').length, r.findings.length);
  const done = bus.history.find((e) => e.type === 'mode.done');
  assert.ok(done.checked.length > 0 && done.checked.every((c) => 'x' in c && 'w' in c && 'rule' in c), 'overlay gets a rect per measured element');
  for (const f of ['events.jsonl', 'trace.jsonl', 'report.json', 'summary.json', 'light.png', 'dark.png']) assert.ok(fs.existsSync(path.join(r.runDir, f)), `missing ${f}`);
  const rep = read(r.runDir, 'report.json');
  assert.equal(rep.kind, 'design'); assert.equal(rep.url, fixture('sample.html')); assert.ok(rep.stamp.tool && rep.stamp.rulesHash);
  assert.equal(rep.violations.length, r.findings.length); assert.ok(rep.byRule.contrast >= 1);
  assert.ok(rep.outcome.distinct > 0 && rep.outcome.distinct < rep.outcome.counted, 'light+dark twins are one defect');
  assert.equal(readTrace(path.join(r.runDir, 'trace.jsonl')).length, bus.history.length, 'the trace is the whole event stream');
});

test('dig on a clean page: exit 0 and no findings', async () => {
  const r = await dig({ url: fixture('clean.html'), name: 't-clean' });
  assert.equal(r.exitCode, 0); assert.equal(r.status, 'pass'); assert.equal(r.findings.length, 0);
  assert.equal(read(r.runDir, 'report.json').outcome.status, 'pass');
});

test('a page that cannot be loaded is NOT RUN (exit 2), reported as such, never a pass', async () => {
  const bus = new EventBus();
  const r = await dig({ url: 'http://127.0.0.1:9/', name: 't-down' }, { bus });
  assert.equal(r.exitCode, 2); assert.equal(r.status, 'not_run'); assert.match(r.problem, /could not load|HTTP|blank/i);
  assert.ok(types(bus).includes('not_run')); assert.equal(bus.history.at(-1).status, 'not_run');
  const rep = read(r.runDir, 'report.json'); assert.equal(rep.status, 'not_run'); assert.equal(rep.violations.length, 0);
});

test('a storage-state file that does not exist is NOT RUN, not a silent anonymous run', async () => {
  const r = await dig({ url: fixture('clean.html'), name: 't-state', storageState: path.join(runs, 'nope.json') });
  assert.equal(r.exitCode, 2); assert.match(r.problem, /storage state file not found/);
});

test('cascade: each distinct defect is judged once (light+dark twins share a verdict), nothing is dropped', async () => {
  resetBreaker();
  const jev = await startMock();
  Object.assign(process.env, { TYPESAFE_API_KEY: 'k', TYPESAFE_BASE_URL: jev.base });
  try {
    const bus = new EventBus();
    const r = await dig({ url: fixture('sample.html'), name: 't-cascade', triage: 'cascade' }, { bus });
    const distinct = new Set(r.findings.map((f) => `${f.rule}|${f.element}|${f.detail.replace(/\s*\((?:light|dark) mode\)/, '')}`)).size;
    assert.ok(distinct < r.findings.length);
    assert.equal(jev.calls(), distinct, 'one Jev call per distinct defect, not per finding');
    assert.ok(r.findings.every((f) => f.verdict), 'every finding, twins included, carries a verdict');
    assert.equal(bus.history.filter((e) => e.type === 'verdict').length, r.findings.length);
    assert.equal(bus.history.filter((e) => e.type === 'decision' && e.kind === 'triage').length, distinct);
    assert.ok(bus.history.some((e) => e.type === 'stage.end' && e.model === 'jev-1.13' && e.costUsd > 0), 'Jev spend is metered live');
    assert.equal(r.exitCode, 1);
  } finally { delete process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFE_BASE_URL; jev.close(); resetBreaker(); }
});

test('cascade with Jev unauthorised and no Claude: findings go to a person and still fail the run (never a silent pass)', async () => {
  resetBreaker();
  const http = await import('node:http');
  const bad = await new Promise((res) => { const s = http.createServer((q, r) => { r.statusCode = 401; r.end('{"error":"unauthorised"}'); }).listen(0, () => res(s)); });
  Object.assign(process.env, { TYPESAFE_API_KEY: 'wrong', TYPESAFE_BASE_URL: `http://127.0.0.1:${bad.address().port}` });
  try {
    const r = await dig({ url: fixture('sample.html'), name: 't-outage', triage: 'cascade' });
    assert.ok(r.findings.length > 0 && r.findings.every((f) => f.verdict === 'unjudged'), 'unjudged, not dismissed');
    assert.equal(r.exitCode, 1);
  } finally { delete process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFE_BASE_URL; bad.closeAllConnections(); bad.close(); resetBreaker(); }
});

test('tunnel: clicks each distinct control, flags dead clicks, keeps the report schema', async () => {
  const bus = new EventBus();
  const r = await tunnel({ url: fixture('sample.html'), name: 't-tunnel', max: 8 }, { bus });
  assert.equal(r.exitCode, 1);
  assert.equal(r.coverage.exercised, 3); assert.equal(r.coverage.stopReason, 'all-controls-tested');
  assert.ok(r.findings.every((f) => f.rule === 'dead-click'));
  const t = types(bus);
  assert.ok(t.includes('control.found') && t.includes('control.pick') && t.includes('control.click') && t.includes('control.result'));
  assert.ok(bus.history.filter((e) => e.type === 'control.pick').every((e) => e.rect && e.rect.width > 0), 'every pick carries a rect for the overlay');
  const rep = read(r.runDir, 'report.json'); assert.equal(rep.kind, 'flow'); assert.equal(rep.steps.length, 3); assert.ok(rep.coverage);
});

test('tunnel on a page whose button does something: clean, exit 0', async () => {
  const r = await tunnel({ url: fixture('clean.html'), name: 't-tunnel-clean', max: 5 });
  assert.equal(r.exitCode, 0, JSON.stringify(r.findings)); assert.equal(r.coverage.exercised, 1);
});

test('tunnel NOT RUN when the page is down', async () => {
  const r = await tunnel({ url: 'http://127.0.0.1:9/', name: 't-tunnel-down' });
  assert.equal(r.exitCode, 2); assert.equal(r.status, 'not_run');
});

test('a tall page is measured screen by screen at the real window size: 100vh stays one screen, content far below is found', async () => {
  const bus = new EventBus();
  const r = await dig({ url: fixture('tall.html'), name: 't-tall' }, { bus });
  assert.ok(r.findings.some((f) => f.key === 'deep-faint|contrast'), 'text 3000px down is measured, background read from the real layers');
  const done = bus.history.filter((e) => e.type === 'mode.done');
  assert.ok(done[0].screens >= 4, `several screens (${done[0].screens})`);
  const measured = bus.history.filter((e) => e.type === 'screen.measured');
  assert.equal(measured.length, done[0].screens); assert.ok(measured.every((e) => e.checked.every((c) => c.y > -800 && c.y < 1600)), 'overlay rects are window coordinates of that screen');
  const rep = JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(rep.viewport, { width: 1280, height: 800, mobile: false }, 'the viewport is never stretched');
  assert.equal(done[1].skipped?.startsWith('no dark mode'), true, 'no dark mode here: dark is skipped, not checked twice');
  assert.ok(r.findings.every((f) => f.mode === 'light'));
});
