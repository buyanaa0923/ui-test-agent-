import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv, loadEnv } from '../src/env.mjs';

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
