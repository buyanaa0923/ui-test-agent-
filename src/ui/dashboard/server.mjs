// Live dashboard. Run `mole dashboard`, open http://localhost:4173 - it tails runs/ every second,
// so time and cost move while a scan or flow is running.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { collect as collectScorecard } from '../../eval/scorecard-data.mjs';
import { P } from '../../core/paths.mjs';

const root = P.root;
const runsDir = P.runs;
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const page = (name) => fs.readFileSync(path.join(import.meta.dirname, name), 'utf8');
const mime = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webm': 'video/webm' };

function listRuns() {
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const dir = path.join(runsDir, d.name);
    const events = readJsonl(path.join(dir, 'events.jsonl'));
    const start = events.find((e) => e.type === 'run_start');
    const end = events.find((e) => e.type === 'run_end');
    const stages = events.filter((e) => e.type === 'stage_end');
    const running = events.filter((e) => e.type === 'stage_start').slice(stages.length)[0]?.stage;
    const report = readJson(path.join(dir, 'report.json'));
    const shots = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    return {
      id: d.name, mtime: fs.statSync(dir).mtimeMs, done: !!end, running: end ? null : running || 'starting',
      kind: report?.kind || (d.name.startsWith('flow') ? 'flow' : d.name.startsWith('smoke') ? 'benchmark' : 'design'),
      url: report?.url || null, plannedSteps: start?.plannedSteps ?? null,
      elapsedMs: end ? end.totalMs : (events.at(-1)?.t ?? 0), usd: stages.reduce((s, x) => s + (x.costUsd ?? 0), 0),
      unpriced: stages.filter((x) => x.costUsd == null).length, stages, byRule: report?.byRule || {},
      status: report?.status || null, problem: report?.problem || null, findings: report?.violations || [], steps: report?.steps || [],
      escalations: readJsonl(path.join(dir, 'escalations.jsonl')), shots,
    };
  }).sort((a, b) => b.mtime - a.mtime);
}

const json = (res, body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/state') return json(res, { runs: listRuns(), benchmark: readJson(path.join(runsDir, 'benchmark.json')), now: Date.now() });
  if (u.pathname === '/api/scorecard') return json(res, collectScorecard(root));
  if (u.pathname === '/scorecard') { res.setHeader('content-type', mime['.html']); return res.end(page('scorecard.html')); }
  if (u.pathname.startsWith('/runs/')) {
    const f = path.join(root, decodeURIComponent(u.pathname));
    if (!f.startsWith(runsDir) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', mime[path.extname(f)] || 'application/octet-stream');
    return fs.createReadStream(f).pipe(res);
  }
  res.setHeader('content-type', mime['.html']);
  res.end(page('dashboard.html'));
}

export function startDashboard({ port = Number(process.env.PORT || 4173), log = console.log } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer(handle);
    server.listen(port, () => { log(`Dashboard: http://localhost:${port}   Judge scorecard: http://localhost:${port}/scorecard`); resolve(server); });
  });
}
