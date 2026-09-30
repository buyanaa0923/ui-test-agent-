// Single source of truth for where things live, so no module guesses the repo root from its own depth.
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const P = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  runs: process.env.MOLE_RUNS_DIR ? path.resolve(process.env.MOLE_RUNS_DIR) : path.join(ROOT, 'runs'),
  eval: path.join(ROOT, 'eval'),
  bench: path.join(ROOT, 'bench'),
  fixtures: path.join(ROOT, 'test-pages'),
  assets: path.join(ROOT, 'assets'),
};
