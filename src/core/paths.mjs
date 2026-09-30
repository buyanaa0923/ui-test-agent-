// Single source of truth for where things live, so no module guesses the repo root from its own depth.
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const P = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  // Runs land where people look: MOLE_RUNS_DIR, else <project>/.mole/runs when a Claude Code plugin names the project
  // (MOLE_PROJECT_DIR), else runs/ in this repository.
  runs: process.env.MOLE_RUNS_DIR ? path.resolve(process.env.MOLE_RUNS_DIR) : process.env.MOLE_PROJECT_DIR ? path.join(path.resolve(process.env.MOLE_PROJECT_DIR), '.mole', 'runs') : path.join(ROOT, 'runs'),
  eval: path.join(ROOT, 'eval'),
  bench: path.join(ROOT, 'bench'),
  fixtures: path.join(ROOT, 'test-pages'),
  assets: path.join(ROOT, 'assets'),
};
