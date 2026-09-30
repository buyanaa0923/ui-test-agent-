import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge } from '../../src/models/judge.mjs';
import { Meter } from '../../src/core/meter.mjs';
import { withRetry, CircuitBreaker, BudgetExceeded } from '../../src/core/resilience.mjs';
import { validateVerdicts } from '../../src/models/schema.mjs';

const F = [{ key: 'a|contrast', rule: 'contrast', element: 'p', text: 'x', detail: 'd', mode: 'light', severity: 'medium' }, { key: 'b|font', rule: 'font-family', element: 'p', text: 'y', detail: 'd', mode: 'light', severity: 'low' }];
const usage = { model: 'claude-sonnet-5-5', inputTokens: 100, outputTokens: 20 };
const pricing = { models: { 'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10 }, heuristic: { inputPerM: 0, outputPerM: 0 } } };
const meter = (maxUsd) => new Meter({ runDir: fs.mkdtempSync(path.join(os.tmpdir(), 'uta-')), pricing, maxUsd });

test('valid verdicts are applied; unknown keys are dropped (model cannot invent findings)', async () => {
  const out = await judge(F, { send: async () => ({ text: JSON.stringify([{ key: 'a|contrast', verdict: 'real', severity: 'high', reason: 'r', fix: 'f' }, { key: 'zzz|invented', verdict: 'real' }]), usage }) });
  assert.equal(out[0].verdict, 'real');
  assert.equal(out[1].verdict, 'needs_human'); // no verdict returned for b
  assert.equal(out.length, 2);
});

test('malformed output triggers one repair attempt, then a valid answer is used', async () => {
  let n = 0;
  const out = await judge(F, { send: async () => ({ text: n++ === 0 ? 'Sorry, here you go: [oops' : JSON.stringify(F.map((f) => ({ key: f.key, verdict: 'real' }))), usage }) });
  assert.equal(n, 2);
  assert.equal(out[0].verdict, 'real');
});

test('persistently invalid output degrades to unjudged, never a fake verdict', async () => {
  const out = await judge(F, { send: async () => ({ text: 'not json', usage }) });
  assert.ok(out.every((f) => f.verdict === 'unjudged'));
});

test('bad verdict enum is rejected by the schema', () => {
  const v = validateVerdicts([{ key: 'a', verdict: 'maybe' }], new Set(['a']));
  assert.equal(v.ok, false);
});

test('withRetry retries transient errors and gives up on auth errors', async () => {
  let n = 0;
  assert.equal(await withRetry(async () => { if (++n < 3) throw new Error('503 overloaded'); return 'ok'; }, { baseMs: 1 }), 'ok');
  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new Error('401 unauthorized'); }, { baseMs: 1 }));
  assert.equal(n, 1);
});

test('circuit breaker opens after repeated failures and fails fast', async () => {
  const b = new CircuitBreaker({ threshold: 2, coolMs: 60000 });
  for (let i = 0; i < 2; i++) await b.run(async () => { throw new Error('down'); }).catch(() => {});
  let called = false;
  await assert.rejects(b.run(async () => { called = true; }), /circuit open/);
  assert.equal(called, false);
});

test('budget cap stops model calls once spent', async () => {
  const m = meter(0.0001);
  const h = m.start('x'); m.end(h, { model: 'claude-sonnet-5-5', inputTokens: 100000, outputTokens: 0 }); // $0.20
  assert.throws(() => m.assertBudget(), BudgetExceeded);
  const out = await judge(F, { meter: m, send: async () => { throw new Error('must not be called'); } });
  assert.ok(out.every((f) => f.verdict === 'unjudged' && /budget/.test(f.reason)));
});
