// Every report says exactly what produced it, so a number shown to a reviewer can be reproduced.
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function stamp(root) {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const tokensRaw = read('config/tokens.json');
  const tokens = JSON.parse(tokensRaw);
  const rules = crypto.createHash('sha256').update(read('src/design-checks.mjs')).digest('hex').slice(0, 12);
  return {
    tool: `${pkg.name}@${pkg.version}`,
    designSystem: `${tokens.source.package}@${tokens.source.version}`,
    tokensHash: crypto.createHash('sha256').update(tokensRaw).digest('hex').slice(0, 12),
    rulesHash: rules,
    trigger: process.env.RUN_TRIGGER || 'manual', // set RUN_TRIGGER=scheduled in cron/launchd so scheduled runs can be counted
    node: process.version,
    at: new Date().toISOString()
  };
}
