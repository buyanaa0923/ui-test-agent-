// Cross-platform test runner (the `VAR=1 cmd` npm-script form does not work on Windows shells).
// Never reads .env, so tests can not spend real model money. Usage: node scripts/test.mjs [--flags] [files]; default: every test/**/*.test.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/core/paths.mjs';

const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === 'helpers' ? [] : walk(p)) : /\.test\.mjs$/.test(n) ? [p] : []; });
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--')); // e.g. --test-reporter=tap
const given = args.filter((a) => !a.startsWith('--'));
const files = given.length ? given : walk(path.join(ROOT, 'test'));
const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...flags, ...files], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, UTA_NO_DOTENV: '1' } });
process.exit(r.status ?? 1);
