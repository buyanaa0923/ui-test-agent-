import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeCascade } from '../src/cascade.mjs';
import { Meter } from '../src/meter.mjs';
import { resetBreaker } from '../src/typesafe.mjs';

const mockJev = (handler) => new Promise((resolve) => {
  const calls = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const body = JSON.parse(b); calls.push(body); const [st, js] = handler(body, calls.length); res.statusCode = st; res.end(JSON.stringify(js)); }); })
    .listen(0, () => resolve({ opts: { base: `http://127.0.0.1:${srv.address().port}`, key: 'k' }, calls, close: () => { srv.closeAllConnections(); srv.close(); } }));
});
const noul = (id, p, c) => [200, { model: 'jev-1.13.0', answers: { [id]: { type: 'noul', noul: p, confidence: c } }, usage: { input_tokens: 100, output_tokens: 5 } }];
const pricing = { models: { 'jev-1.13': { inputPerM: 0.042, outputPerM: 0 }, 'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10 }, heuristic: { inputPerM: 0, outputPerM: 0 } } };
const setup = (jev, claudeSend) => {
  resetBreaker();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casc-'));
  const meter = new Meter({ runDir, pricing, maxUsd: 5 });
  const claudeCalls = [];
  const send = async (prompt) => { claudeCalls.push(prompt); return claudeSend(prompt); };
  return { runDir, meter, claudeCalls, c: makeCascade({ meter, runDir, jevOpts: jev.opts, claude: { send } }) };
};
const F = (key) => ({ key, rule: 'contrast', element: 'p', text: 't', detail: 'contrast 2.5:1', mode: 'light', severity: 'medium', ctx: {} });
const claudeVerdicts = (verdict) => async (prompt) => ({ text: JSON.stringify([...prompt.matchAll(/"key": "([^"]+)"/g)].map((m) => ({ key: m[1], verdict }))), usage: { model: 'claude-sonnet-5-5', inputTokens: 500, outputTokens: 50 } });
const decisions = (dir) => fs.readFileSync(path.join(dir, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('confident Jev confirmations are settled without calling Claude', async () => {
  const jev = await mockJev(() => noul('real_defect', 0.97, 0.92));
  const t = setup(jev, claudeVerdicts('real'));
  const out = await t.c.triage([F('a|contrast'), F('b|contrast')]);
  assert.ok(out.every((f) => f.verdict === 'real' && f.by === 'jev'));
  assert.equal(t.claudeCalls.length, 0);
  assert.equal(decisions(t.runDir).filter((d) => d.escalated === false).length, 2);
  jev.close();
});

test('dismissal needs more confidence than confirmation (0.85 < 0.9 gate escalates)', async () => {
  const jev = await mockJev(() => noul('real_defect', 0.1, 0.85));
  const t = setup(jev, claudeVerdicts('real'));
  const [f] = await t.c.triage([F('a|contrast')]);
  assert.equal(f.by, 'claude'); assert.equal(f.verdict, 'real');
  assert.equal(t.claudeCalls.length, 1);
  jev.close();
});

test('low-confidence Jev answers escalate, and only those', async () => {
  const jev = await mockJev((body) => (JSON.stringify(body.state).includes('"key-lo"') ? noul('real_defect', 0.5, 0.4) : noul('real_defect', 0.95, 0.9)));
  const t = setup(jev, claudeVerdicts('false_positive'));
  const lo = { ...F('lo|contrast'), element: 'key-lo' };
  const out = await t.c.triage([F('hi|contrast'), { ...lo, detail: '"key-lo"' }]);
  assert.equal(out[0].by, 'jev'); assert.equal(out[1].by, 'claude'); assert.equal(out[1].verdict, 'false_positive');
  jev.close();
});

test('Jev outage: everything falls back to Claude, Jev is not hammered', async () => {
  const jev = await mockJev(() => [401, { error: 'bad key' }]);
  const t = setup(jev, claudeVerdicts('real'));
  const out = await t.c.triage([F('a|c'), F('b|c'), F('c|c'), F('d|c')]);
  assert.ok(out.every((f) => f.by === 'claude'));
  assert.ok(jev.calls.length <= 4);
  assert.ok(decisions(t.runDir).some((d) => d.event === 'jev_failed'));
  jev.close();
});

test('both down: findings stay unjudged, none is silently dropped or invented', async () => {
  const jev = await mockJev(() => [401, { error: 'x' }]);
  const t = setup(jev, async () => { throw new Error('claude down'); });
  const out = await t.c.triage([F('a|c'), F('b|c')]);
  assert.equal(out.length, 2); assert.ok(out.every((f) => f.verdict === 'unjudged'));
  jev.close();
});

test('risk screen: clearly safe is allowed, clearly risky is blocked, uncertain goes to Claude', async () => {
  const jev = await mockJev((body) => { const l = body.state.control_label; return l === 'Search' ? noul('risky', 0.02, 0.95) : l === 'Delete account' ? noul('risky', 0.98, 0.9) : noul('risky', 0.5, 0.3); });
  const t = setup(jev, async () => ({ text: '{"risky":false,"confidence":0.95}', usage: { model: 'claude-sonnet-5-5', inputTokens: 80, outputTokens: 10 } }));
  assert.deepEqual(await t.c.screenRisk({ role: 'button', label: 'Search' }), { risky: false, by: 'jev' });
  assert.deepEqual(await t.c.screenRisk({ role: 'button', label: 'Delete account' }), { risky: true, by: 'jev' });
  assert.deepEqual(await t.c.screenRisk({ role: 'button', label: 'Хаах' }), { risky: false, by: 'claude' });
  jev.close();
});

test('risk screen fails safe when every model is unavailable', async () => {
  const jev = await mockJev(() => [401, {}]);
  const t = setup(jev, async () => { throw new Error('down'); });
  assert.deepEqual(await t.c.screenRisk({ role: 'button', label: 'Хайх' }), { risky: true, by: 'fail-safe' });
  jev.close();
});

test('risk-screen calls are metered: Jev and Claude spend show up in the run total and count against the budget', async () => {
  const jev = await mockJev((body) => (body.state.control_label === 'Search' ? noul('risky', 0.02, 0.95) : noul('risky', 0.5, 0.3)));
  try {
    const t = setup(jev, async () => ({ text: '{"risky":false,"confidence":0.95}', usage: { model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 100 } }));
    await t.c.screenRisk({ role: 'button', label: 'Search' });        // settled by Jev
    const afterJev = t.meter.finish().totalUsd;
    assert.ok(afterJev > 0, 'Jev risk call must be counted');
    await t.c.screenRisk({ role: 'button', label: 'Хаах' });          // escalates to Claude
    const total = t.meter.finish().totalUsd;
    assert.ok(total - afterJev >= 0.003, `Claude risk call must be counted, got +${total - afterJev}`); // 1000 in x $2/M + 100 out x $10/M = 0.003
  } finally { jev.close(); }
});

test('risk screen stops calling models once the budget is spent (fail-safe: skip the control)', async () => {
  const jev = await mockJev(() => noul('risky', 0.02, 0.95));
  try {
    resetBreaker();
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'casc-'));
    const meter = new Meter({ runDir, pricing, maxUsd: 0.0000001 });
    const c = makeCascade({ meter, runDir, jevOpts: jev.opts, claude: { send: async () => ({ text: '{"risky":false,"confidence":0.99}', usage: { model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 100 } }) } });
    const first = await c.screenRisk({ role: 'button', label: 'Search' });
    const second = await c.screenRisk({ role: 'button', label: 'Search again' });
    assert.equal(first.risky, false);
    assert.deepEqual(second, { risky: true, by: 'fail-safe' });
  } finally { jev.close(); }
});
