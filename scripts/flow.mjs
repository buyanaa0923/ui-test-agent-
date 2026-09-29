// Button/flow explorer: tries the interactive elements of a page one by one, records what each click did,
// and reports dead buttons, JS errors, failed requests. The picker (heuristic or Jev) chooses the next element.
// Usage: node scripts/flow.mjs <url> [--max 20] [--picker heuristic|jev] [--name label] [--judge]
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, storageStateOption, ssoButtonOption } from '../src/browser.mjs';
import { Meter } from '../src/meter.mjs';
import { makePicker } from '../src/jev.mjs';
import { judge } from '../src/judge.mjs';
import { loadChecked } from '../src/guard.mjs';
import { stamp } from '../src/stamp.mjs';
import { makeCascade } from '../src/cascade.mjs';
import { shouldReportDeadClick, dropToolCausedErrors, isAllowedRequest, errorFindingRule } from '../src/flow-rules.mjs';

const args = process.argv.slice(2);
const valued = new Set(['--max', '--picker', '--name', '--storage-state', '--sso-button', '--allow-origin']);
const url = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
if (!url) { console.error('Usage: node scripts/flow.mjs <url> [--max 20] [--picker heuristic|jev] [--name label] [--risk-screen] [--judge]'); process.exit(2); }
const max = Number(opt('max', 20));
const name = opt('name', 'flow');
const root = path.resolve(import.meta.dirname, '..');
const pricing = JSON.parse(fs.readFileSync(path.join(root, 'config/pricing.json'), 'utf8'));
const runDir = path.join(root, 'runs', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const meter = new Meter({ runDir, pricing, plannedSteps: max + 3 });
const pickerKind = opt('picker', process.env.PICKER || 'heuristic');
const cascade = makeCascade({ meter, runDir });
const riskScreen = pickerKind === 'jev' || args.includes('--risk-screen');
const pick = makePicker({ kind: pickerKind, meter, runDir });
const origin = new URL(url).origin;

let h = meter.start('launch');
const browser = await launchBrowser();
meter.end(h);
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...storageStateOption() });
const page = await context.newPage();
// Never leave the app under test, except for origins the operator names (--allow-origin, repeatable, or UTA_ALLOW_ORIGINS=a,b): a hub loads its modules from other ports.
const allowedOrigins = new Set([origin, ...args.flatMap((a, i) => (a === '--allow-origin' ? [new URL(args[i + 1]).origin] : [])), ...(process.env.UTA_ALLOW_ORIGINS || '').split(',').filter(Boolean).map((o) => new URL(o).origin)]);
const blockedOrigins = new Set();
let blockedNow = 0;
await context.route('**/*', (route) => {
  const u = route.request().url();
  if (isAllowedRequest(u, allowedOrigins)) return route.continue();
  blockedOrigins.add(new URL(u).origin); blockedNow++;
  return route.abort();
});

const events = { errors: [], failed: [] };
page.on('pageerror', (e) => events.errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && events.errors.push(`console: ${m.text().slice(0, 160)}`));
page.on('response', (r) => r.status() >= 400 && new URL(r.url()).origin === origin && events.failed.push(`${r.status()} ${r.url().replace(origin, '')}`));

const enumerate = () => page.evaluate(() => {
  document.querySelectorAll('[data-uta]').forEach((e) => e.removeAttribute('data-uta'));
  const sel = 'button, a[href], [role=button], [role=tab], [role=menuitem], summary, input[type=checkbox], input[type=radio], [role=switch]';
  const out = [];
  document.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden' || cs.display === 'none') return;
    const href = el.getAttribute('href') || '';
    if (/^(https?:)?\/\//.test(href) && !href.startsWith(location.origin)) return; // external
    const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase());
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50) || '(no name)';
    el.setAttribute('data-uta', String(out.length));
    const active = ['aria-selected', 'aria-current', 'aria-pressed'].some((a) => ['true', 'page'].includes(el.getAttribute(a)));
    let selfLink = false;
    if (el.tagName === 'A' && href && !href.startsWith('#')) { try { const u = new URL(el.href, location.href); selfLink = u.origin === location.origin && u.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '') && u.search === location.search; } catch { /* keep false */ } }
    out.push({ id: out.length, role, label, active, selfLink, disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' });
  });
  return out;
});

const snapshot = () => page.evaluate(() => {
  const str = document.body.innerText + '|' + document.documentElement.className + '|' + document.documentElement.lang;
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return {
    url: location.pathname + location.search + location.hash,
    dialogs: document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]').length,
    hash: hash + '/' + document.querySelectorAll('*').length,
    scroll: Math.round(scrollY / 50),
    expanded: [...document.querySelectorAll('[aria-expanded="true"],[aria-selected="true"],[aria-checked="true"]')].length
  };
});

h = meter.start('load', { url });
const loaded = await loadChecked(page, url, { ssoButton: ssoButtonOption() });
meter.end(h);
if (!loaded.ok) {
  await browser.close();
  console.error(`NOT RUN: ${loaded.problem}\nNothing was tested. Check the app is running and reachable (curl -i ${url}).`);
  meter.finish();
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ url, kind: 'flow', status: 'not_run', problem: loaded.problem, byRule: {}, violations: [], steps: [] }, null, 2));
  process.exit(2);
}

const visited = new Set();
const steps = [];
const findings = [];
const seen = new Set();
let stopReason = 'max-steps';
const RISKY = /(delete|remove|устгах|pay|төлбөр|logout|sign out|гарах|reset|drop)/i;

for (let i = 0; i < max; i++) {
  const sso = ssoButtonOption();
  if (sso) { // token lives in memory only: every fresh load needs the sign-in step again; losing the session ends the run loudly
    const again = await loadChecked(page, url, { ssoButton: sso });
    if (!again.ok) { stopReason = `session-lost: ${again.problem}`; break; }
  } else await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(250);
  const cands = (await enumerate()).map((c) => ({ ...c, visited: visited.has(`${c.role}|${c.label}`) || c.disabled || RISKY.test(c.label) }));
  cands.forEach((c) => seen.add(`${c.role}|${c.label}`));
  if (!cands.some((c) => !c.visited)) { stopReason = 'all-controls-tested'; break; }
  const p = await pick({ goal: `Exercise every distinct control on ${new URL(url).pathname}`, candidates: cands });
  if (p.choice == null || p.choice < 0 || !cands[p.choice] || cands[p.choice].visited) { stopReason = 'picker-returned-no-usable-choice'; break; }
  const c = cands[p.choice];
  visited.add(`${c.role}|${c.label}`);
  if (riskScreen) {
    const rs = await cascade.screenRisk(c);
    if (rs.risky) { steps.push({ n: i + 1, target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence, skipped: `risk screen (${rs.by})`, changed: false, errors: [], failedRequests: [] }); continue; }
  }

  h = meter.start(`click-${i + 1}`, { target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence });
  const before = await snapshot();
  events.errors.length = 0; events.failed.length = 0; blockedNow = 0;
  let clickError = null;
  try { await page.locator(`[data-uta="${c.id}"]`).first().click({ timeout: 3000 }); } catch (e) { clickError = e.message.split('\n')[0].slice(0, 120); }
  await page.waitForTimeout(400);
  const filtered = dropToolCausedErrors(events.errors, blockedNow);
  events.errors.splice(0, events.errors.length, ...filtered.errors);
  const after = clickError ? before : await snapshot();
  meter.end(h);

  const changed = before.url !== after.url || before.dialogs !== after.dialogs || before.hash !== after.hash || before.scroll !== after.scroll || before.expanded !== after.expanded;
  const step = { n: i + 1, target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence, selfLink: !!c.selfLink, before: before.url, after: after.url, dialogOpened: after.dialogs > before.dialogs, changed, errors: [...events.errors], failedRequests: [...events.failed], clickError };
  steps.push(step);
  await page.screenshot({ path: path.join(runDir, `step-${String(i + 1).padStart(2, '0')}.png`) }).catch(() => {});

  const add = (rule, severity, detail) => findings.push({ key: `${c.role}:${c.label}|${rule}`, rule, severity, element: `${c.role} "${c.label}"`, text: c.label, mode: 'flow', detail, step: i + 1 });
  if (clickError) add('click-failed', 'high', `could not click: ${clickError}`);
  if (step.errors.length) { const er = errorFindingRule(blockedNow); add(er.rule, er.severity, (er.rule === 'js-error' ? '' : 'while a cross-origin request was blocked by the tool: ') + step.errors[0]); }
  if (step.failedRequests.length) add('failed-request', 'high', step.failedRequests[0]);
  if (shouldReportDeadClick({ clickError, changed, errors: step.errors, active: c.active, selfLink: c.selfLink })) add('dead-click', 'medium', 'click produced no visible change (url, dialog, DOM or state)');
}
await browser.close();

let judged = findings;
if (args.includes('--judge')) judged = await judge(findings, { meter, context: `Flow test of ${url}. "dead-click" means no URL/DOM/dialog change after clicking; some controls legitimately do nothing visible (copy, analytics).` });

const byRule = {};
for (const f of judged) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
const exercised = steps.filter((x) => !x.skipped).length;
const coverage = { controlsFound: seen.size, exercised, selfLinksNotCountedAsDead: steps.filter((x) => x.selfLink && !x.changed).length, crossOriginBlocked: [...blockedOrigins], skippedByRiskScreen: steps.filter((x) => x.skipped).length, skippedByLabelRule: [...seen].filter((k) => RISKY.test(k.split('|')[1]) && ![...visited].includes(k)).length, stopReason };
console.log(`${url}\nCoverage: ${exercised}/${coverage.controlsFound} distinct controls exercised, stopped: ${stopReason}${coverage.crossOriginBlocked.length ? `\nNot tested (requests to other origins are blocked by design): ${coverage.crossOriginBlocked.join(', ')}` : ''}\nSteps: ${steps.length} | findings: ${judged.length} ${JSON.stringify(byRule)}`);
for (const s of steps) console.log(`  ${String(s.n).padStart(2)}. ${s.target.padEnd(38)} ${s.pickedBy}(${s.confidence}) ${s.skipped ? 'SKIPPED ' + s.skipped : s.changed ? 'changed' : 'NO EFFECT'}${s.dialogOpened ? ' +dialog' : ''}${s.errors.length ? ' ERR' : ''}`);
for (const f of judged) console.log(`  [${f.severity}] ${f.rule} :: ${f.element} :: ${f.detail}${f.verdict ? `  => ${f.verdict}` : ''}`);
const summary = meter.finish();
console.log(`Time ${summary.totalMs} ms | model cost $${summary.totalUsd.toFixed(6)} | report: ${runDir}`);
fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ stamp: stamp(root), url, kind: 'flow', byRule, violations: judged, steps, coverage }, null, 2));
