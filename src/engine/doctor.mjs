// Preflight: "will this work here, and if not, what exactly do I fix?" Pure checks, no printing: the CLI and the MCP
// server both render the results. Keys are never returned, only whether they are present.
import '../core/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P } from '../core/paths.mjs';

const timeout = (ms) => AbortSignal.timeout(ms);
const has = (k) => !!(process.env[k] && process.env[k].trim());

// ok: true | false | 'warn'. onResult is called as each check completes so a display can stream them.
export async function runDoctor({ live = false, url = null, onResult = () => {} } = {}) {
  const results = [];
  const say = (ok, name, detail = '', fix = '') => { const r = { ok, name, detail, fix }; results.push(r); onResult(r); };

  const [maj, min] = process.versions.node.split('.').map(Number);
  say(maj > 20 || (maj === 20 && min >= 11), `Node ${process.version}`, '', 'install Node 20.11 or newer (https://nodejs.org)');

  try { const tokens = JSON.parse(fs.readFileSync(path.join(P.config, 'tokens.json'), 'utf8')); say(true, 'Design tokens', `${tokens.source.package}@${tokens.source.version}`); }
  catch (e) { say(false, 'Design tokens', e.message, 'run `npm run import-tokens -- /path/to/netsecure-design`'); }

  let playwrightOk = true;
  try { await import('playwright'); say(true, 'Playwright installed'); } catch { playwrightOk = false; say(false, 'Playwright installed', '', 'run `npm ci` in the project folder'); }

  if (playwrightOk) {
    try {
      const { launchBrowser } = await import('./browser.mjs');
      const t0 = performance.now();
      let note = '';
      const b = await launchBrowser({ onNote: (m) => { note = m; } });
      const page = await b.newPage(); await page.setContent('<button>ok</button>');
      const ok = (await page.locator('button').count()) === 1;
      const ver = b.version(); await b.close();
      say(ok, 'Browser launches and renders', `${ver}${note ? ', ' + note : ''}, ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      say(false, 'Browser launches', e.message.split('\n')[0], 'run `npx playwright install chromium`; if downloads are blocked here, install Google Chrome, or set CHROMIUM_PATH in .env to any Chromium-based browser');
    }
  }

  const envFile = fs.existsSync(path.join(P.root, '.env'));
  say(envFile ? true : 'warn', '.env file', envFile ? 'found' : 'missing (keys can still come from the shell)', 'copy .env.example to .env and fill in the keys');
  say(has('TYPESAFE_API_KEY') ? true : 'warn', 'Jev key (TYPESAFE_API_KEY)', has('TYPESAFE_API_KEY') ? 'present' : 'not set; Jev steps are skipped and Claude decides alone', 'add it to .env');
  const cli = (process.env.JUDGE_MODE || 'api') === 'cli';
  if (cli) { const w = spawnSync('claude', ['--version'], { encoding: 'utf8' }); say(w.status === 0, 'Claude runner (JUDGE_MODE=cli)', w.status === 0 ? w.stdout.trim() : 'claude command not found', 'install Claude Code, or set JUDGE_MODE=api with ANTHROPIC_API_KEY'); }
  else say(has('ANTHROPIC_API_KEY') ? true : 'warn', 'Claude key (ANTHROPIC_API_KEY)', has('ANTHROPIC_API_KEY') ? 'present' : 'not set; verdicts are skipped', 'use a key from your WORK Anthropic Console so usage is billed to the company');
  say(true, 'Spend cap per run', `$${process.env.BUDGET_USD || 1} (BUDGET_USD)`);

  // Any HTTP answer, even 401/404, means the host is reachable.
  const proxied = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
  const hint = proxied ? 'a proxy is set but Node may not use it: run with NODE_USE_ENV_PROXY=1 (Node 24+), or ask IT to allow this host' : 'ask IT to allow this host, or connect to the network that can reach it';
  for (const [name, host, needed] of [['Jev API', 'https://api.typesafe.ai', true], ['Claude API', 'https://api.anthropic.com', !cli]]) {
    if (!needed) continue;
    try {
      const r = await fetch(host, { method: 'GET', signal: timeout(8000) });
      const body = (await r.text()).slice(0, 200), type = r.headers.get('content-type') || '';
      // A firewall or proxy block looks like a plain-text/HTML 403 or 407; the real APIs answer in JSON or with an empty body.
      const blocked = [403, 407, 451, 502, 503].includes(r.status) && /text\/(plain|html)/.test(type) && /allowlist|blocked|not allowed|denied|proxy|forbidden|firewall/i.test(body);
      say(!blocked, `${name} reachable`, blocked ? `${host} refused by a network filter: "${body.slice(0, 90)}"` : `${host} answered ${r.status}`, hint);
    } catch (e) { say(false, `${name} reachable`, `${host}: ${e.cause?.code || e.message}`, hint); }
  }
  if (url) {
    try { const r = await fetch(url, { signal: timeout(8000) }); say(r.status < 500, 'App under test reachable', `${url} answered ${r.status}`, 'start the app, or check the port'); }
    catch (e) { say(false, 'App under test reachable', `${url}: ${e.cause?.code || e.message}`, 'start the app first, then re-run'); }
  }

  if (live) { // optional proof that the keys really work: one real call each, about $0.001
    if (has('TYPESAFE_API_KEY')) {
      try { const { classifyRisk } = await import('../models/jev.mjs'); const r = await classifyRisk({ label: 'Delete account', context: 'button, settings' }); say(r.risky === true, 'Jev live call', `${r.ms} ms, risky=${r.risky}, p=${r.p}`, 'check the key with `npm run jev:raw`'); }
      catch (e) { say(false, 'Jev live call', e.message.slice(0, 120), 'check the key with `npm run jev:raw`'); }
    }
    if (!cli && has('ANTHROPIC_API_KEY')) {
      try { const { claudeRisk } = await import('../models/judge.mjs'); const r = await claudeRisk({ label: 'Delete account', context: 'button, settings' }); say(r.risky === true, 'Claude live call', `risky=${r.risky}`, 'check ANTHROPIC_API_KEY belongs to the work Console'); }
      catch (e) { say(false, 'Claude live call', e.message.slice(0, 120), 'check ANTHROPIC_API_KEY belongs to the work Console'); }
    }
  }

  const bad = results.filter((r) => r.ok === false), warn = results.filter((r) => r.ok === 'warn');
  return { results, bad: bad.length, warn: warn.length, ready: bad.length === 0, summary: bad.length ? `NOT READY: ${bad.length} problem${bad.length > 1 ? 's' : ''} to fix` : warn.length ? `READY for rule scans. ${warn.length} optional item${warn.length > 1 ? 's' : ''} missing (model steps will be skipped)` : 'READY' };
}
