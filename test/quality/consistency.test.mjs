// The style-consistency benchmark must be able to fail: a detector with a feature family removed must miss drifts,
// and one with no thresholds must flag clean sites.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../src/core/paths.mjs';

const bench = (...extra) => {
  const out = path.join(os.tmpdir(), `consistency-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync('node', ['scripts/quality/consistency.mjs', '--out', out, ...extra], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, report: JSON.parse(fs.readFileSync(out, 'utf8')) };
};

test('the real detector passes its gates, and the numbers are reproducible', () => {
  const a = bench(), b = bench();
  assert.equal(a.code, 0, JSON.stringify(a.report.overall));
  assert.equal(a.report.overall.cleanSitesWithAnyFlag, 0);
  assert.ok(a.report.overall.recall >= 0.95);
  assert.equal(a.report.overall.ruleFindingsPerPage.drifted, 0, 'the drifted pages pass every design rule: only the fingerprint sees them');
  assert.deepEqual(a.report.perMutation, b.report.perMutation);
});

test('sabotage: without the corner features, rounded / pill drifts are missed and the gate fails', () => {
  const r = bench('--sabotage', 'no-corners');
  assert.notEqual(r.code, 0);
  assert.ok(r.report.perMutation.rounded.caught / r.report.perMutation.rounded.cases < 0.5);
});

test('sabotage: with no thresholds, clean sites get flagged and the gate fails', () => {
  const r = bench('--sabotage', 'overfire');
  assert.notEqual(r.code, 0);
  assert.ok(r.report.overall.cleanSitesWithAnyFlag > 0);
});
