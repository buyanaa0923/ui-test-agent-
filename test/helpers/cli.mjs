// Helpers for tests that drive the real CLI as a subprocess, and fixtures that live in test-pages/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../../src/core/paths.mjs';

export const fixture = (name) => pathToFileURL(path.join(ROOT, 'test-pages', name)).href;
export const tmpDir = (prefix = 'mole-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// Run `mole <args>`; never reads .env (tests must not spend money), runs go to a temp folder.
export function mole(args, { env = {}, runs = tmpDir('mole-runs-'), timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'mole.mjs'), ...args], {
      cwd: ROOT, env: { ...process.env, UTA_NO_DOTENV: '1', NO_COLOR: '1', MOLE_RUNS_DIR: runs, TYPESAFE_API_KEY: '', ANTHROPIC_API_KEY: '', ...env },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill(), timeout);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, runs }); });
  });
}

export const ndjson = (text) => text.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
