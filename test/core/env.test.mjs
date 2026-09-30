import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv, loadEnv } from '../../src/core/env.mjs';

test('.env parsing: comments, quotes, export prefix, inline comments, empty values', () => {
  const p = parseEnv('# c\nA=1\nexport B="two words"\nC=\'x\'\nD=val # note\nE=\n\nbad line\n');
  assert.deepEqual(p, { A: '1', B: 'two words', C: 'x', D: 'val', E: '' });
});

test('.env loading never overrides a value that is already set', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uta-')), '.env');
  fs.writeFileSync(f, 'KEEP=file\nNEW=file\n');
  const target = { KEEP: 'shell' };
  const set = loadEnv(f, target);
  assert.deepEqual(target, { KEEP: 'shell', NEW: 'file' });
  assert.deepEqual(set, ['NEW']);
  assert.deepEqual(loadEnv(path.join(os.tmpdir(), 'does-not-exist.env'), {}), []);
});

test('the test process never holds real model keys (tests must not spend money)', () => {
  assert.ok(!process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY is visible to tests: run them through scripts/test.mjs (npm test)');
  assert.ok(!process.env.TYPESAFE_API_KEY, 'TYPESAFE_API_KEY is visible to tests: run them through scripts/test.mjs (npm test)');
});

test('plugin settings: empty options never pass for keys, and the Claude choice maps to a route', async () => {
  const { applyPluginEnv } = await import('../../src/core/env.mjs');
  const e = applyPluginEnv({ TYPESAFE_API_KEY: '${user_config.typesafe_api_key}', ANTHROPIC_API_KEY: ' ${user_config.anthropic_api_key} ', MOLE_CLAUDE_JUDGE: 'login', OTHER: 'kept' });
  assert.deepEqual(e, { MOLE_CLAUDE_JUDGE: 'login', JUDGE_MODE: 'cli', OTHER: 'kept' });
  assert.equal(applyPluginEnv({ MOLE_CLAUDE_JUDGE: 'api-key', ANTHROPIC_API_KEY: 'k' }).JUDGE_MODE, 'api');
  const off = applyPluginEnv({ MOLE_CLAUDE_JUDGE: 'off', ANTHROPIC_API_KEY: 'k' });
  assert.equal(off.JUDGE_MODE, 'off'); assert.equal(off.ANTHROPIC_API_KEY, undefined, 'off means no Claude calls at all');
});
