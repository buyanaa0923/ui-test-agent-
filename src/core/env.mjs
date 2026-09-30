// Loads <project>/.env into process.env so nobody has to `source` it. Variables that are already set win, so a
// value exported in the shell (or by CI) always overrides the file. Set UTA_NO_DOTENV=1 to skip it (tests do).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.mjs';

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function loadEnv(file, target = process.env) {
  if (!fs.existsSync(file)) return [];
  const set = [];
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (target[k] === undefined) { target[k] = v; set.push(k); }
  }
  return set;
}

// Settings that arrive from the Claude Code plugin (plugin.json userConfig -> MCP server env). An option the user left
// empty can arrive as the literal "${user_config.x}", which must never be mistaken for a key.
export function applyPluginEnv(env = process.env) {
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && /^\$\{[^}]*\}$/.test(v.trim())) delete env[k];
  // How Mole asks Claude about unclear findings: the developer's Claude Code login (no key), an API key, or never.
  const judge = (env.MOLE_CLAUDE_JUDGE || '').toLowerCase();
  if (judge === 'login') env.JUDGE_MODE = 'cli';
  else if (judge === 'api-key') env.JUDGE_MODE = 'api';
  else if (judge === 'off') { env.JUDGE_MODE = 'off'; delete env.ANTHROPIC_API_KEY; }
  return env;
}

if (!process.env.UTA_NO_DOTENV) loadEnv(path.join(ROOT, '.env'));
applyPluginEnv();
