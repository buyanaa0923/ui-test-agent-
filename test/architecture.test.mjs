// Keeps docs/ARCHITECTURE.md honest: dependencies point down only, and the engine never prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/core/paths.mjs';

const SRC = path.join(ROOT, 'src');
// who may import whom (by top-level folder under src/)
const ALLOWED = {
  core: ['core'],
  models: ['core', 'models'],
  engine: ['core', 'models', 'engine'],
  eval: ['core', 'models', 'eval'],
  ui: ['core', 'eval', 'ui'],
  mcp: ['core', 'models', 'engine', 'mcp'],
  cli: ['core', 'models', 'engine', 'eval', 'ui', 'mcp', 'cli'],
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.mjs$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = walk(SRC);
const importsOf = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => path.resolve(path.dirname(file), m[1]));
const layer = (abs) => path.relative(SRC, abs).split(path.sep)[0];

test('every src/ file lives in a known layer', () => {
  for (const f of files) assert.ok(ALLOWED[layer(f)], `${path.relative(ROOT, f)} is outside the documented layers`);
});

test('dependencies point down only (see docs/ARCHITECTURE.md)', () => {
  const bad = [];
  for (const f of files) for (const dep of importsOf(f)) {
    if (!dep.startsWith(SRC + path.sep)) continue; // config, assets: fine
    if (!ALLOWED[layer(f)].includes(layer(dep))) bad.push(`${path.relative(ROOT, f)} -> ${path.relative(ROOT, dep)}  (${layer(f)} may not import ${layer(dep)})`);
  }
  assert.deepEqual(bad, []);
});

test('every relative import resolves to a real file', () => {
  const missing = [];
  for (const f of files) for (const dep of importsOf(f)) if (!fs.existsSync(dep)) missing.push(`${path.relative(ROOT, f)} -> ${path.relative(ROOT, dep)}`);
  assert.deepEqual(missing, []);
});

test('only surfaces and commands write to stdout: engine, models, core and eval never print', () => {
  const offenders = [];
  for (const f of files.filter((x) => ['engine', 'models', 'core', 'eval'].includes(layer(x)))) {
    const text = fs.readFileSync(f, 'utf8');
    if (/console\.(log|info|warn|error)\(|process\.std(out|err)\.write/.test(text)) offenders.push(path.relative(ROOT, f));
  }
  assert.deepEqual(offenders, [], 'these files print; emit an event instead');
});
