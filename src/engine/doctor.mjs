// Preflight: "will this work here, and if not, what exactly do I fix?" Pure checks, no printing: the CLI and the MCP
// server both render the results. Keys are never returned, only whether they are present.
import '../core/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P } from '../core/paths.mjs';
import { resolveContract, contractSummary } from './contract.mjs';

const timeout = (ms) => AbortSignal.timeout(ms);
const has = (k) => !!(process.env[k] && process.env[k].trim());

// ok: true | false | 'warn'. onResult is called as each check completes so a display can stream them.
export async function runDoctor({ live = false, url = null, onResult = () => {} } = {}) {
  const results = [];
  const say = (ok, name, detail = '', fix = '') => { const r = { ok, name, detail, fix }; results.push(r); onResult(r); };
  const plugin = has('MOLE_PROJECT_DIR'); // started by the Claude Code plugin: settings come from /plugin, not .env
  const setKey = plugin ? 'in Claude Code: /plugin > Installed > mole > Configure options' : 'add it to .env in the Mole folder, or export it in your shell';

  const [maj, min] = process.versions.node.split('.').map(Number);
  say(maj > 20 || (maj === 20 && min >= 11), `Node ${process.version}`, '', 'install Node 20.11 or newer (https://nodejs.org), then restart Claude Code');

  if (plugin) say(fs.existsSync(process.env.MOLE_PROJECT_DIR) ? true : false, 'Project', process.env.MOLE_PROJECT_DIR, 'start Claude Code from your project folder');
  say(true, 'Run output', P.runs);

  try {
    const c = resolveContract();
    const from = contractSummary(c).sources.at(-1);
    say(c.notes.length ? 'warn' : true, 'Design contract', `${c.name} · ${c.platform} · ${c.notes.length ? c.notes[0] : from}`, 'run /mole:design in Claude Code (or `mole design init`) to create a DESIGN.md for this project');
  } catch (e) { say(false, 'Design contract', e.message, 'fix the DESIGN.md (the message names the line), then `mole design show`'); }

  let playwrightOk = true;
  try { await import('playwright'); say(true, 'Playwright installed'); } catch { playwrightOk = false; say(false, 'Playwright installed', '', plugin ? `run "npm ci" in ${P.root}, then restart Claude Code` : 'run `npm ci` in the Mole folder'); }

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
      say(false, 'Browser launches', e.message.split('\n')[0], 'install Google Chrome or Microsoft Edge (Mole uses it), or run `npx playwright install chromium`');
    }
  }

  if (!plugin) {
    const envFile = fs.existsSync(path.join(P.root, '.env'));
    say(envFile ? true : 'warn', '.env file', envFile ? 'found' : 'missing (keys can still come from the shell)', 'copy .env.example to .env and fill in the keys');
  }
  say(has('TYPESAFE_API_KEY') ? true : 'warn', 'Jev key', has('TYPESAFE_API_KEY') ? 'present' : 'not set: the free deterministic checks run, no model judging', setKey);
  const mode = process.env.JUDGE_MODE || 'api';
  if (mode === 'cli') {
    const w = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
    say(w.status === 0, 'Claude second opinion', w.status === 0 ? `your Claude Code login (${w.stdout.trim()})` : 'the claude command was not found', 'install Claude Code so `claude` works in a terminal, or pick api-key / off');
  } else if (mode === 'off') say(true, 'Claude second opinion', 'off: findings Jev is unsure about go to a person');
  else say(has('ANTHROPIC_API_KEY') ? true : 'warn', 'Claude second opinion', has('ANTHROPIC_API_KEY') ? 'Anthropic API key present' : 'no Anthropic API key: unsure findings go to a person', plugin ? `${setKey} (or pick "login" to use your Claude Code login, no key)` : 'set ANTHROPIC_API_KEY, or JUDGE_MODE=cli to use your Claude Code login');
  say(true, 'Spend cap per run', `$${process.env.BUDGET_USD || 1} (BUDGET_USD)`);

  // Any HTTP answer, even 401/404, means the host is reachable. Only hosts this setup will actually call are checked.
  const proxied = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
  const hint = proxied ? 'a proxy is set but Node may not use it: run with NODE_USE_ENV_PROXY=1 (Node 24+), or ask IT to allow this host' : 'ask IT to allow this host, or connect to the network that can reach it';
  for (const [name, host, needed] of [['Jev API', 'https://api.typesafe.ai', has('TYPESAFE_API_KEY')], ['Claude API', 'https://api.anthropic.com', mode === 'api' && has('ANTHROPIC_API_KEY')]]) {
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
    catch (e) { say(false, 'App under test reachable', `${url}: ${e.cause?.code || e.message}`, 'start the app first (e.g. npm run dev), then re-run'); }
  }

  if (live) { // optional proof that the keys really work: one real call each, about $0.001
    if (has('TYPESAFE_API_KEY')) {
      try { const { classifyRisk } = await import('../models/jev.mjs'); const r = await classifyRisk({ label: 'Delete account', context: 'button, settings' }); say(r.risky === true, 'Jev live call', `${r.ms} ms, risky=${r.risky}, p=${r.p}`, 'check the Jev key'); }
      catch (e) { say(false, 'Jev live call', e.message.slice(0, 120), 'check the Jev key'); }
    }
    if (mode === 'cli' || (mode === 'api' && has('ANTHROPIC_API_KEY'))) {
      try { const { claudeRisk } = await import('../models/judge.mjs'); const r = await claudeRisk({ label: 'Delete account', context: 'button, settings' }); say(r.risky === true, 'Claude live call', `risky=${r.risky}`, mode === 'cli' ? 'check that `claude -p "hi"` works in a terminal' : 'check the Anthropic API key'); }
      catch (e) { say(false, 'Claude live call', e.message.slice(0, 120), mode === 'cli' ? 'check that `claude -p "hi"` works in a terminal' : 'check the Anthropic API key'); }
    }
  }

  const bad = results.filter((r) => r.ok === false), warn = results.filter((r) => r.ok === 'warn');
  return { results, bad: bad.length, warn: warn.length, ready: bad.length === 0, summary: bad.length ? `NOT READY: ${bad.length} problem${bad.length > 1 ? 's' : ''} to fix` : warn.length ? `READY. ${warn.length} optional item${warn.length > 1 ? 's' : ''} not set up (see the notes)` : 'READY' };
}
