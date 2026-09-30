import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startMock } from '../helpers/mock-typesafe.mjs';
import { scoreBinary, ece, coverage } from '../../src/eval/metrics.mjs';
import { ROOT } from '../../src/core/paths.mjs';

const root = ROOT;
const run = (env, args) => new Promise((resolve) => {
  const p = spawn('node', ['scripts/eval/eval-jev.mjs', ...args], { cwd: root, env: { ...process.env, ...env } });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (code) => resolve({ code, out }));
});

test('datasets are well-formed and balanced', () => {
  const risk = fs.readFileSync(path.join(root, 'eval/risk.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(risk.length, 64);
  assert.equal(risk.filter((r) => r.positive).length, 32);
  assert.equal(risk.filter((r) => r.lang === 'mn').length, 32);
  const tri = fs.readFileSync(path.join(root, 'eval/triage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(tri.length >= 40 && tri.every((t) => t.finding.rule && typeof t.positive === 'boolean'));
  assert.equal(new Set([...risk, ...tri].map((r) => r.id)).size, risk.length + tri.length);
});

test('metrics: perfect and worst-case calibration', () => {
  const good = [1, 2, 3, 4].map(() => ({ positive: true, pred: true, confidence: 1 }));
  assert.equal(scoreBinary(good).accuracy, 1);
  assert.equal(ece(good).ece, 0);
  const overconfident = [1, 2, 3, 4].map((i) => ({ positive: true, pred: i > 2, confidence: 1 }));
  assert.equal(ece(overconfident).ece, 0.5);
  assert.equal(coverage(good, [0.9])[0].coverage, 1);
});

test('live run records, then --replay reproduces identical numbers offline', async () => {
  const mock = await startMock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalcache-'));
  const rep1 = path.join(dir, 'r1.json'), rep2 = path.join(dir, 'r2.json');
  const live = await run({ TYPESAFE_API_KEY: 'k', TYPESAFE_BASE_URL: mock.base, EVAL_CACHE_DIR: dir, EVAL_REPORT: rep1 }, ['--set', 'all']);
  assert.equal(live.code, 0, live.out);
  const callsLive = mock.calls();
  assert.ok(callsLive >= 64 + 40);
  mock.close();
  // no server, no key: replay must still work
  const replay = await run({ TYPESAFE_API_KEY: '', TYPESAFE_BASE_URL: 'http://127.0.0.1:1', EVAL_CACHE_DIR: dir, EVAL_REPORT: rep2 }, ['--set', 'all', '--replay']);
  assert.equal(replay.code, 0, replay.out);
  const a = JSON.parse(fs.readFileSync(rep1, 'utf8')), b = JSON.parse(fs.readFileSync(rep2, 'utf8'));
  assert.equal(b.mode, 'replay');
  for (const k of ['risk', 'triage']) {
    assert.equal(b.sets[k].failed, 0);
    assert.deepEqual({ ...a.sets[k].jev, latencyMs: 0, costUsd: 0, costPer1kDecisions: 0 }, { ...b.sets[k].jev, latencyMs: 0, costUsd: 0, costPer1kDecisions: 0 });
  }
});

test('--claude arm and cascade scoring run end to end (mock Claude, mock Jev)', async () => {
  const http = await import('node:http');
  const jev = await startMock();
  const claude = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
        const prompt = JSON.parse(b).messages[0].content;
        let text;
        if (prompt.startsWith('Control label:')) text = JSON.stringify({ risky: /Delete|Устгах|Pay|Төлбөр/i.test(prompt), confidence: 0.9 });
        else text = JSON.stringify([...prompt.matchAll(/"key": "([^"]+)"/g)].map((m) => ({ key: m[1], verdict: 'real', reason: 'r', fix: 'f' })));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 400, output_tokens: 40 } }));
      });
    }).listen(0, () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections(); srv.close(); } }));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalcache-'));
  const rep = path.join(dir, 'r.json');
  const r = await run({ TYPESAFE_API_KEY: 'k', TYPESAFE_BASE_URL: jev.base, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: claude.base, EVAL_CACHE_DIR: dir, EVAL_REPORT: rep }, ['--set', 'all', '--claude']);
  jev.close(); claude.close();
  assert.equal(r.code, 0, r.out);
  const rpt = JSON.parse(fs.readFileSync(rep, 'utf8'));
  for (const k of ['risk', 'triage']) {
    const s = rpt.sets[k];
    assert.ok(s.claude.n > 0 && s.cascade.n > 0, `${k}: claude and cascade scored`);
    assert.ok(s.cascade.escalationRate >= 0 && s.cascade.escalationRate <= 1);
    assert.ok(s.claude.costUsd > 0);
    assert.ok(Array.isArray(s.jev.errors) && Array.isArray(s.claude.errors));
  }
  const pl = rpt.sets.triage.pipeline;
  assert.ok(pl.deterministicResolved >= 5 && pl.deterministicWrong === 0, 'structural exemptions resolve cases and agree with the labels');
  assert.ok(pl.cascade.n === 43 && pl.jev.n === 43);
});
