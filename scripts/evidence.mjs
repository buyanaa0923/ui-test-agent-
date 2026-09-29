// One command that refreshes every number the scorecard shows: tests, mutation benchmark, determinism, smoke.
// Model evaluations (eval:jev) are separate because they need keys or a recording.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { stamp } from '../src/stamp.mjs';

const root = path.resolve(import.meta.dirname, '..');
const run = (args, env = process.env) => spawnSync('node', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
const results = {};

process.stdout.write('tests ............ ');
const t = run(['--test', '--test-reporter=tap', ...fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => `test/${f}`)], { ...process.env, UTA_NO_DOTENV: '1' }); // tests must never pick up real keys
const num = (k) => Number((t.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] ?? 0);
const names = [...t.stdout.matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map((m) => ({ ok: m[1] === 'ok', name: m[2].replace(/ \(\d.*ms\)$/, '') }));
results.tests = { total: num('tests'), pass: num('pass'), fail: num('fail'), names, at: new Date().toISOString() };
console.log(`${results.tests.pass}/${results.tests.total} pass`);

for (const [label, script] of [['mutation bench', 'scripts/bench.mjs'], ['determinism', 'scripts/determinism.mjs'], ['smoke', 'scripts/smoke.mjs']]) {
  process.stdout.write(`${label.padEnd(17, ' ')} `);
  const r = run([script]);
  const last = r.stdout.trim().split('\n').filter((l) => /Overall|Determinism|caught/.test(l)).pop() || '(no summary line)';
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${last.trim()}`);
  results[label] = r.status === 0;
}
fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
fs.writeFileSync(path.join(root, 'runs', 'tests.json'), JSON.stringify({ stamp: stamp(root), ...results.tests }, null, 2));
process.exit(results.tests.fail || Object.values(results).includes(false) ? 1 : 0);
