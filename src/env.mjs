// Loads <project>/.env into process.env so nobody has to `source` it. Variables that are already set win, so a
// value exported in the shell (or by CI) always overrides the file. Set UTA_NO_DOTENV=1 to skip it (tests do).
import fs from 'node:fs';
import path from 'node:path';

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

if (!process.env.UTA_NO_DOTENV) loadEnv(path.join(import.meta.dirname, '..', '.env'));
