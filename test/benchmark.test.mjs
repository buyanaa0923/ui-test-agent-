// The benchmark must be able to fail. If a broken rule set still scores 100%, the benchmark proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const bench = (tokensFile, env = {}) => {
  const out = path.join(os.tmpdir(), `bench-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync('node', ['scripts/bench.mjs', '--n', '220', '--out', out, ...(tokensFile ? ['--tokens', tokensFile] : [])], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
};
const base = JSON.parse(fs.readFileSync(path.join(root, 'config/tokens.json'), 'utf8'));
const sabotage = (fn) => { const t = structuredClone(base); fn(t); const f = path.join(os.tmpdir(), `sab-${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(t)); return f; };

test('real tokens: benchmark is perfect and reproducible', () => {
  const a = bench(), b = bench();
  assert.equal(a.code, 0);
  assert.equal(a.report.overall.exactMatchRate, 1);
  assert.equal(a.report.overall.falsePositiveRateOnCleanPages, 0);
  assert.deepEqual(a.report.perRule, b.report.perRule); // same seed, same numbers
});

test('sabotaged contrast threshold is detected', () => {
  const r = bench(sabotage((t) => { t.netos.contrast.normal = 3; }));
  assert.notEqual(r.code, 0);
  assert.ok(r.report.perRule.find((x) => x.rule === 'contrast').recall < 0.5);
});

test('sabotaged token import (wrong allowed button height) is detected', () => {
  const r = bench(sabotage((t) => { t.netos.buttonHeightsPx = [...t.netos.buttonHeightsPx, 34, 30, 42, 46, 24, 26, 50]; }));
  assert.notEqual(r.code, 0);
});

test('a rule that over-fires is detected as false positives', () => {
  const r = bench(sabotage((t) => { t.netos.allowedFonts = ['Inter']; })); // Montserrat / JetBrains Mono now flagged on clean pages
  assert.notEqual(r.code, 0);
  assert.ok(r.report.overall.precision < 1);
});

test('removing the structural exemptions is detected (the exemption negatives are real tests)', () => {
  const r = bench(null, { UTA_NO_EXEMPTIONS: '1' });
  assert.notEqual(r.code, 0);
  assert.ok(r.report.overall.cleanPagesWithFindings + r.report.overall.fp > 0);
  assert.ok(r.report.overall.precision < 1);
});
