// Record/replay for model calls. A live run records every request/response pair (no keys are stored: keys travel in
// headers, not in the request body); --replay re-scores from the recording with no network and no cost, so a judge can
// reproduce the exact numbers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export function fileCache(dir, { replayOnly = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (req) => path.join(dir, crypto.createHash('sha1').update(stable(req)).digest('hex') + '.json');
  return {
    replayOnly,
    get(req) { try { return JSON.parse(fs.readFileSync(file(req), 'utf8')); } catch { return null; } },
    put(req, res) { if (!replayOnly) fs.writeFileSync(file(req), JSON.stringify(res)); }
  };
}
export { stable };
