import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecords, recordId } from '../../src/eval/real-findings.mjs';

const f = (over = {}) => ({ key: 'span.x|contrast', rule: 'contrast', severity: 'medium', element: 'span.x', text: 'Save', mode: 'light', detail: 'contrast 4.43:1, needs 4.5:1 (light mode)', rect: { x: 10, y: 20, w: 50, h: 12 },
  ctx: { tag: 'span', ancestors: ['button.a', 'div.b'], fontSize: 11 }, verdict: 'real', by: 'jev', reason: 'model said so', fix: 'use darker', ...over });
const run = (id, url, violations, extra = {}) => ({ runId: id, report: { kind: 'design', url, stamp: { at: '2026-09-30T00:00:00.000Z', tool: 't', rulesHash: 'r' }, violations, ...extra } });
const OPTS = { hosts: ['localhost:5200', 'localhost:5300'], flowOnlyHosts: ['localhost:5181'] };

test('light and dark variants and repeats across pages become ONE record, labelled empty, with page list', () => {
  const recs = buildRecords([
    run('a', 'http://localhost:5200/p1', [f(), f({ mode: 'dark', key: 'span.x|contrast@dark', detail: 'contrast 4.43:1, needs 4.5:1 (dark mode)' })]),
    run('b', 'http://localhost:5200/p2', [f()]),
  ], OPTS);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.label, '');
  assert.equal(r.positive, null);
  assert.equal(r.finding.mode, 'light');
  assert.deepEqual(r.source.modes, ['dark', 'light']);
  assert.deepEqual(r.source.pages, ['http://localhost:5200/p1', 'http://localhost:5200/p2']);
});
test('model verdicts from earlier runs never leak into the held-out set', () => {
  const [r] = buildRecords([run('a', 'http://localhost:5200/p1', [f()])], OPTS);
  for (const k of ['verdict', 'by', 'reason', 'fix']) assert.equal(k in r.finding, false, k);
  assert.equal(JSON.stringify(r).includes('model said so'), false);
});
test('different text or element is a different record; ids are stable and independent of run order', () => {
  const A = run('a', 'http://localhost:5200/p1', [f(), f({ text: 'Cancel' })]);
  const B = run('b', 'http://localhost:5200/p2', [f({ element: 'span.y', key: 'span.y|contrast' })]);
  const one = buildRecords([A, B], OPTS), two = buildRecords([B, A], OPTS);
  assert.equal(one.length, 3);
  assert.deepEqual(one.map((r) => r.id), two.map((r) => r.id));
  assert.equal(recordId(f()), recordId(f({ mode: 'dark', detail: 'other' })));
  assert.notEqual(recordId(f()), recordId(f({ text: 'Cancel' })));
});
test('not_run reports, benchmark/eval runs, file: pages and unknown hosts are ignored', () => {
  const recs = buildRecords([
    run('nr', 'http://localhost:5200/p1', [f()], { status: 'not_run' }),
    { runId: 'bench', report: { kind: 'benchmark', violations: [f()] } },
    run('file', 'file:///x.html', [f()]),
    run('other', 'https://example.com/', [f()]),
  ], OPTS);
  assert.equal(recs.length, 0);
});
test("the Hefesto UI (a different design system) contributes flow findings only, never design-token findings", () => {
  const recs = buildRecords([
    run('h1', 'http://localhost:5181/issues', [f({ rule: 'raw-color-literal' })]),
    { runId: 'h2', report: { kind: 'flow', url: 'http://localhost:5181/', stamp: { at: '2026-09-30T00:00:00Z' }, violations: [f({ rule: 'dead-click', element: 'button "X"', mode: 'flow', key: 'button:X|dead-click' })] } },
  ], OPTS);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].finding.rule, 'dead-click');
  assert.equal(recs[0].source.kind, 'flow');
});
test('--since drops runs made before the cutoff (e.g. before the login-wall guard existed)', () => {
  const old = run('old', 'http://localhost:5200/p1', [f()]); old.report.stamp.at = '2026-09-29T21:00:00.000Z';
  assert.equal(buildRecords([old], { ...OPTS, since: '2026-09-29T21:36:00Z' }).length, 0);
  assert.equal(buildRecords([old], OPTS).length, 1);
});

test('--flow-since drops only FLOW runs made before the cutoff (flow bugs fixed later must not be labelled as findings)', () => {
  const dc = f({ rule: 'dead-click', element: 'link "X"', mode: 'flow', key: 'link:X|dead-click' });
  const oldFlow = { runId: 'oldflow', report: { kind: 'flow', url: 'http://localhost:5200/', stamp: { at: '2026-09-29T21:37:00Z' }, violations: [dc] } };
  const newFlow = { runId: 'newflow', report: { kind: 'flow', url: 'http://localhost:5200/', stamp: { at: '2026-09-29T23:00:00Z' }, violations: [{ ...dc, element: 'link "Y"' }] } };
  const design = run('d', 'http://localhost:5200/p1', [f()]); design.report.stamp.at = '2026-09-29T21:40:00Z';
  const recs = buildRecords([oldFlow, newFlow, design], { ...OPTS, flowSince: '2026-09-29T22:00:00Z' });
  assert.deepEqual(recs.map((r) => r.source.kind).sort(), ['design', 'flow']);
  assert.ok(recs.find((r) => r.source.kind === 'flow').finding.element.includes('Y'));
});
test('records carry a root-cause cluster so shared causes (one token, many buttons) are visible in the metrics', () => {
  const a = buildRecords([run('a', 'http://localhost:5200/p', [f({ text: 'One' }), f({ text: 'Two' }), f({ text: 'Three', detail: 'contrast 2.56:1, needs 4.5:1 (light mode)' })])], OPTS);
  const clusters = a.map((r) => r.source.cluster);
  assert.equal(new Set(clusters).size, 2);
  assert.equal(clusters.filter((c) => c === clusters[0]).length >= 1, true);
  assert.ok(a.every((r) => !/light mode|dark mode/.test(r.source.cluster)));
});

test('since applies to design runs and flowSince to flow runs: they are independent cutoffs', () => {
  const dc = f({ rule: 'dead-click', element: 'link "X"', mode: 'flow', key: 'link:X|dead-click' });
  const flow = { runId: 'fl', report: { kind: 'flow', url: 'http://localhost:5200/', stamp: { at: '2026-09-29T22:30:00Z' }, violations: [dc] } };
  const design = run('d', 'http://localhost:5200/p1', [f()]); design.report.stamp.at = '2026-09-29T22:00:00Z';
  const recs = buildRecords([flow, design], { ...OPTS, since: '2026-09-29T23:00:00Z', flowSince: '2026-09-29T22:15:00Z' });
  assert.deepEqual(recs.map((r) => r.source.kind), ['flow']); // design (22:00) is before its own cutoff (23:00); flow (22:30) is after its cutoff (22:15)
});
test('a flow report that also design-checked its pages contributes only its flow findings (Hefesto antd pages stay out)', () => {
  const flow = { key: 'button:Save|dead-click', rule: 'dead-click', severity: 'medium', element: 'button "Save"', text: 'Save', mode: 'flow', detail: 'click produced no visible change', step: 2 };
  const recs = buildRecords([run('t', 'http://localhost:5181/', [flow, f({ page: '/' })], { kind: 'flow' })], OPTS);
  assert.deepEqual(recs.map((r) => r.finding.rule), ['dead-click']);
});
