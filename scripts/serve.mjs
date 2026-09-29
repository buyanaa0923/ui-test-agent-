// Live dashboard. Run `npm run dashboard`, open http://localhost:4173 - it tails runs/ every second,
// so time and cost move while a scan or flow is running.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { collect as collectScorecard } from '../src/scorecard-data.mjs';

const root = path.resolve(import.meta.dirname, '..');
const runsDir = path.join(root, 'runs');
const port = Number(process.env.PORT || 4173);
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function listRuns() {
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const dir = path.join(runsDir, d.name);
    const events = fs.existsSync(path.join(dir, 'events.jsonl'))
      ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      : [];
    const start = events.find((e) => e.type === 'run_start');
    const end = events.find((e) => e.type === 'run_end');
    const stages = events.filter((e) => e.type === 'stage_end');
    const running = events.filter((e) => e.type === 'stage_start').slice(stages.length)[0]?.stage;
    const report = readJson(path.join(dir, 'report.json'));
    const esc = fs.existsSync(path.join(dir, 'escalations.jsonl')) ? fs.readFileSync(path.join(dir, 'escalations.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const shots = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    const mtime = fs.statSync(dir).mtimeMs;
    return {
      id: d.name, mtime, done: !!end, running: end ? null : running || 'starting',
      kind: report?.kind || (d.name.startsWith('flow') ? 'flow' : d.name.startsWith('smoke') ? 'benchmark' : 'design'),
      url: report?.url || null, plannedSteps: start?.plannedSteps ?? null,
      elapsedMs: end ? end.totalMs : (events.at(-1)?.t ?? 0), usd: stages.reduce((s, x) => s + (x.costUsd ?? 0), 0),
      unpriced: stages.filter((x) => x.costUsd == null).length, stages, byRule: report?.byRule || {},
      status: report?.status || null, problem: report?.problem || null, findings: report?.violations || [], steps: report?.steps || [], escalations: esc, shots
    };
  }).sort((a, b) => b.mtime - a.mtime);
}

const mime = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/state') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ runs: listRuns(), benchmark: readJson(path.join(runsDir, 'benchmark.json')), now: Date.now() }));
  }
  if (u.pathname === '/api/scorecard') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(collectScorecard(root)));
  }
  if (u.pathname === '/scorecard') {
    res.setHeader('content-type', mime['.html']);
    return res.end(fs.readFileSync(path.join(import.meta.dirname, 'scorecard.html'), 'utf8'));
  }
  if (u.pathname.startsWith('/runs/')) {
    const f = path.join(root, decodeURIComponent(u.pathname));
    if (!f.startsWith(runsDir) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', mime[path.extname(f)] || 'application/octet-stream');
    return fs.createReadStream(f).pipe(res);
  }
  res.setHeader('content-type', mime['.html']);
  res.end(fs.readFileSync(path.join(import.meta.dirname, 'dashboard.html'), 'utf8'));
}).listen(port, () => console.log(`Dashboard: http://localhost:${port}   Judge scorecard: http://localhost:${port}/scorecard`));
