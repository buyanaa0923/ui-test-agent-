import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduce, decidedBy, bySeverity, median, claudeOnlyFloorUsd } from '../../src/ui/state.mjs';

const run = (events, opts) => events.reduce(reduce, createState(opts));
const start = { type: 'run.start', t: 0, command: 'dig', url: 'http://x', modes: ['light', 'dark'], triage: 'cascade', runId: 'r', runDir: '/r' };
const F = (key, rule, mode = 'light', sev = 'medium', detail = 'd') => ({ type: 'finding', t: 5, key, rule, severity: sev, element: 'el', detail, mode });

test('dig: steps advance load -> light -> dark -> sniff and finish ok', () => {
  let s = run([start]);
  assert.deepEqual(s.steps.map((x) => [x.id, x.status]), [['load', 'run'], ['light', 'wait'], ['dark', 'wait'], ['judge', 'wait']]);
  s = run([start, { type: 'page.loaded', t: 1, elements: 50, ms: 900 }, { type: 'mode.done', t: 2, mode: 'light', elements: 50, findings: 0 }, { type: 'mode.done', t: 3, mode: 'dark', elements: 50, findings: 0 }]);
  assert.deepEqual(s.steps.map((x) => x.status), ['ok', 'ok', 'ok', 'run']);
  assert.equal(s.phase, 'judging');
  s = reduce(s, { type: 'run.end', t: 4, status: 'pass', exitCode: 0, totalMs: 4, totalUsd: 0 });
  assert.equal(s.phase, 'done'); assert.ok(s.steps.every((x) => x.status === 'ok'));
});

test('rules-only dig has no sniff step and no judging phase', () => {
  const s = run([{ ...start, triage: 'none' }, { type: 'page.loaded', t: 1, elements: 5 }, { type: 'mode.done', t: 2, mode: 'light', elements: 5, findings: 0 }, { type: 'mode.done', t: 3, mode: 'dark', elements: 5, findings: 0 }]);
  assert.ok(!s.steps.some((x) => x.id === 'judge'));
  assert.notEqual(s.phase, 'judging');
});

test('cascade decisions: Jev settles, an unsure one is pending until Claude answers', () => {
  const dec = (o) => ({ type: 'decision', t: 9, kind: 'triage', ...o });
  let s = run([start, F('a', 'contrast'), F('b', 'button-height'), dec({ key: 'a', by: 'jev', decision: 'real', confidence: 0.91, ms: 280, inputTokens: 700 }), dec({ key: 'b', by: 'jev', decision: 'uncertain', confidence: 0.55, ms: 300, inputTokens: 700 })]);
  assert.equal(s.jev.settled, 1); assert.equal(s.jev.unsure, 1);
  assert.equal(s.findings.find((f) => f.key === 'b').pending, 'claude');
  s = reduce(s, dec({ key: 'b', by: 'claude', decision: 'false_positive' }));
  const b = s.findings.find((f) => f.key === 'b');
  assert.equal(b.pending, null); assert.equal(b.verdict, 'false_positive'); assert.equal(s.claude.consulted, 1);
  assert.deepEqual(decidedBy(s), { rule: 0, jev: 1, claude: 1, human: 0, dismissed: 1 });
});

test('when Claude is down too the finding is flagged for a person, never dropped', () => {
  const s = run([start, F('a', 'contrast'), { type: 'decision', t: 9, kind: 'triage', key: 'a', by: 'none', decision: 'unjudged' }]);
  assert.equal(s.human, 1); assert.equal(s.findings[0].verdict, 'unjudged'); assert.equal(decidedBy(s).human, 1);
});

test('light and dark twins count once in the summaries', () => {
  const s = run([start, F('a', 'control-unlabeled', 'light', 'high'), F('a@dark', 'control-unlabeled', 'dark', 'high')]);
  assert.equal(s.findings.length, 2);
  assert.deepEqual(bySeverity(s), { high: 1 });
});

test('cost comes from the meter, per model, and Jev/Claude spend is split', () => {
  const s = run([start, { type: 'stage.end', t: 1, model: 'jev-1.13', costUsd: 0.0004, spentUsd: 0.0004 }, { type: 'stage.end', t: 2, model: 'claude-sonnet-5-5', costUsd: 0.003, spentUsd: 0.0034 }, { type: 'stage.end', t: 3, model: 'playwright', costUsd: 0, spentUsd: 0.0034 }]);
  assert.equal(s.costUsd, 0.0034); assert.equal(s.jev.usd, 0.0004); assert.equal(s.claude.usd, 0.003);
});

test('tunnel: pick -> risk -> click -> result updates coverage and dead-click count', () => {
  const t = { type: 'run.start', t: 0, command: 'tunnel', url: 'u', max: 10, picker: 'jev', riskScreen: true };
  let s = run([t, { type: 'control.found', t: 1, count: 5 }, { type: 'control.pick', t: 2, n: 1, role: 'tab', label: 'Pipeline', by: 'jev', confidence: 0.9 }]);
  assert.equal(s.tunnel.current.label, 'Pipeline');
  s = reduce(s, { type: 'control.risk', t: 3, label: 'Pipeline', by: 'jev', decision: 'safe', confidence: 0.97 });
  assert.equal(s.tunnel.current.risk.decision, 'safe');
  s = reduce(s, { type: 'control.result', t: 4, n: 1, label: 'Pipeline', changed: true });
  s = reduce(s, { type: 'control.pick', t: 5, n: 2, role: 'button', label: 'Theme', by: 'heuristic', confidence: 0.6 });
  s = reduce(s, { type: 'control.result', t: 6, n: 2, label: 'Theme', deadClick: true });
  s = reduce(s, { type: 'control.pick', t: 7, n: 3, role: 'button', label: 'Pay', by: 'jev', confidence: 0.9 });
  s = reduce(s, { type: 'control.result', t: 8, n: 3, label: 'Pay', skipped: 'risk screen (jev)' });
  assert.deepEqual([s.tunnel.exercised, s.tunnel.skipped, s.tunnel.dead], [2, 1, 1]);
  assert.equal(s.tunnel.current, null); assert.equal(s.tunnel.log.length, 3);
});

test('NOT RUN is its own terminal state and marks the running step failed', () => {
  const s = run([start, { type: 'not_run', t: 1, problem: 'needs login' }, { type: 'run.end', t: 2, status: 'not_run', exitCode: 2, totalMs: 2, totalUsd: 0 }]);
  assert.equal(s.phase, 'not_run'); assert.equal(s.problem, 'needs login');
  assert.ok(s.steps.every((x) => x.status === 'fail'), 'nothing is shown as passed');
});

test('unknown events are ignored; reducer never mutates its input', () => {
  const s0 = run([start]); const frozen = JSON.stringify(s0);
  const s1 = reduce(s0, { type: 'something.new', t: 1 });
  assert.equal(JSON.stringify(s0), frozen); assert.equal(s1.command, 'dig');
  reduce(s0, F('a', 'contrast')); assert.equal(JSON.stringify(s0), frozen);
});

test('median and the Claude-only floor are honest', () => {
  assert.equal(median([]), null); assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
  const pricing = { models: { 'claude-sonnet-5-5': { inputPerM: 2 } } };
  const s = run([start, { type: 'decision', t: 1, kind: 'triage', key: 'k', by: 'jev', decision: 'real', confidence: 0.9, ms: 1, inputTokens: 1_000_000 }], { pricing });
  assert.equal(claudeOnlyFloorUsd(s), 2, 'Jev input tokens priced at Claude input rate (a lower bound)');
  assert.equal(claudeOnlyFloorUsd(run([start])), null, 'no Jev tokens, no claim');
});
