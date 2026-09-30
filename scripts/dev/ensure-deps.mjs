// Plugin bootstrap (SessionStart hook): a plugin is copied without node_modules, so install runtime dependencies once.
// Never blocks or fails the session: if the install cannot run, say what to do and exit 0.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../src/core/paths.mjs';

if (fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) process.exit(0);
console.error('[mole] first run: installing dependencies (one time)...');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const r = spawnSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
if (r.status !== 0) console.error(`[mole] could not install dependencies automatically. Run "npm ci" in ${ROOT}, then "mole doctor".`);
else console.error('[mole] ready. If a browser is missing, run "npx playwright install chromium" (or install Google Chrome), then "mole doctor".');
process.exit(0);
