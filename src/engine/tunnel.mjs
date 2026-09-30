// tunnel: click through a page's interactive controls one by one ("tunnelling") and record what each click did.
// Reports dead buttons, JS errors and failed requests. A picker (heuristic or Jev) chooses the next control; a
// risk screen (Jev, then Claude) decides whether a control is safe to click. Pure engine: events out, result back.
import path from 'node:path';
import { P } from '../core/paths.mjs';
import { createRun, writeReport } from '../core/run.mjs';
import { EventBus } from '../core/events.mjs';
import { EXIT, NotRunError } from '../core/errors.mjs';
import { stamp } from '../core/stamp.mjs';
import { toSsoRegex } from './browser.mjs';
import { openSession } from './session.mjs';
import { loadChecked } from './guard.mjs';
import { makePicker } from '../models/jev.mjs';
import { judge } from '../models/judge.mjs';
import { makeCascade } from '../models/cascade.mjs';
import { shouldReportDeadClick, dropToolCausedErrors, isAllowedRequest, errorFindingRule } from './flow-rules.mjs';
import { countsAsDefect } from './dig.mjs';
import { uniqueCounted } from '../core/findings.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RISKY = /(delete|remove|устгах|pay|төлбөр|logout|sign out|гарах|reset|drop)/i;

export async function tunnel(opts, ctx = {}) {
  const {
    url, max = 20, name = 'flow', picker = process.env.PICKER || 'heuristic', riskScreen: riskOpt = false,
    triage = 'none', // 'none' | 'claude'
    allowOrigins = [], storageState = null, ssoButton = null, headed = false, record = false, pace = 500,
  } = opts;
  const bus = ctx.bus || new EventBus();
  const run = createRun({ name, bus, plannedSteps: max + 3, maxUsd: opts.maxUsd });
  const { runDir, meter, runId } = run;
  const riskScreen = picker === 'jev' || riskOpt;
  bus.emit('run.start', { command: 'tunnel', url, max, runId, runDir, picker, riskScreen, triage });

  const cascade = makeCascade({ meter, runDir, bus });
  const pick = makePicker({ kind: picker, meter, runDir, bus });
  const origin = new URL(url).origin;

  const finishNotRun = async (problem, session) => {
    await session?.close();
    const s = meter.finish();
    writeReport(runDir, { url, kind: 'flow', status: 'not_run', problem, byRule: {}, violations: [], steps: [] });
    bus.emit('not_run', { problem });
    bus.emit('run.end', { status: 'not_run', exitCode: EXIT.NOT_RUN, totalMs: s.totalMs, totalUsd: s.totalUsd, findings: 0, byRule: {} });
    return { status: 'not_run', exitCode: EXIT.NOT_RUN, problem, runDir, runId, findings: [], byRule: {} };
  };

  let session;
  try {
    session = await openSession({ headed, storageState, record, runDir, attach: ctx.attach, bus, meter });
  } catch (e) {
    if (e instanceof NotRunError) return finishNotRun(e.problem, null);
    throw e;
  }
  const { context, page } = session;

  // Never leave the app under test, except for origins the operator names: a hub loads its modules from other ports.
  const allowedOrigins = new Set([origin, ...allowOrigins.map((o) => new URL(o).origin), ...(process.env.UTA_ALLOW_ORIGINS || '').split(',').filter(Boolean).map((o) => new URL(o).origin)]);
  const blockedOrigins = new Set();
  let blockedNow = 0;
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (isAllowedRequest(u, allowedOrigins)) return route.continue();
    blockedOrigins.add(new URL(u).origin); blockedNow++;
    return route.abort();
  });

  const seenEvents = { errors: [], failed: [] };
  page.on('pageerror', (e) => seenEvents.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && seenEvents.errors.push(`console: ${m.text().slice(0, 160)}`));
  page.on('response', (r) => r.status() >= 400 && new URL(r.url()).origin === origin && seenEvents.failed.push(`${r.status()} ${r.url().replace(origin, '')}`));

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

  let h = meter.start('load', { url });
  const loaded = await loadChecked(page, url, { ssoButton: toSsoRegex(ssoButton) });
  meter.end(h);
  if (!loaded.ok) return finishNotRun(loaded.problem, session);
  bus.emit('page.loaded', { url, elements: loaded.elements });

  const visited = new Set();
  const steps = [];
  const findings = [];
  const seen = new Set();
  let stopReason = 'max-steps';

  for (let i = 0; i < max; i++) {
    const sso = toSsoRegex(ssoButton);
    if (sso) { // token lives in memory only: every fresh load needs the sign-in step again; losing the session ends the run loudly
      const again = await loadChecked(page, url, { ssoButton: sso });
      if (!again.ok) { stopReason = `session-lost: ${again.problem}`; break; }
    } else await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(250);
    const cands = (await session.quiet(enumerate)).map((c) => ({ ...c, visited: visited.has(`${c.role}|${c.label}`) || c.disabled || RISKY.test(c.label) }));
    cands.forEach((c) => seen.add(`${c.role}|${c.label}`));
    bus.emit('control.found', { count: seen.size, onPage: cands.length });
    if (!cands.some((c) => !c.visited)) { stopReason = 'all-controls-tested'; break; }
    const p = await pick({ goal: `Exercise every distinct control on ${new URL(url).pathname}`, candidates: cands });
    if (p.choice == null || p.choice < 0 || !cands[p.choice] || cands[p.choice].visited) { stopReason = 'picker-returned-no-usable-choice'; break; }
    const c = cands[p.choice];
    visited.add(`${c.role}|${c.label}`);
    const loc = page.locator(`[data-uta="${c.id}"]`).first();
    const rect = await loc.boundingBox().catch(() => null);
    bus.emit('control.pick', { n: i + 1, role: c.role, label: c.label, by: p.source, confidence: p.confidence, rect });
    if (riskScreen) {
      const rs = await cascade.screenRisk(c);
      if (rs.risky) {
        steps.push({ n: i + 1, target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence, skipped: `risk screen (${rs.by})`, changed: false, errors: [], failedRequests: [] });
        bus.emit('control.result', { n: i + 1, label: c.label, skipped: `risk screen (${rs.by})` });
        continue;
      }
    }

    h = meter.start(`click-${i + 1}`, { target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence });
    const before = await snapshot();
    seenEvents.errors.length = 0; seenEvents.failed.length = 0; blockedNow = 0;
    bus.emit('control.click', { n: i + 1, role: c.role, label: c.label, rect });
    if (headed && pace) await sleep(pace); // let the overlay's mole walk to the control; headless runs never wait
    let clickError = null;
    try { await loc.click({ timeout: 3000 }); } catch (e) { clickError = e.message.split('\n')[0].slice(0, 120); }
    await page.waitForTimeout(400);
    const filtered = dropToolCausedErrors(seenEvents.errors, blockedNow);
    seenEvents.errors.splice(0, seenEvents.errors.length, ...filtered.errors);
    const after = clickError ? before : await snapshot();
    meter.end(h);

    const changed = before.url !== after.url || before.dialogs !== after.dialogs || before.hash !== after.hash || before.scroll !== after.scroll || before.expanded !== after.expanded;
    const step = { n: i + 1, target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence, selfLink: !!c.selfLink, before: before.url, after: after.url, dialogOpened: after.dialogs > before.dialogs, changed, errors: [...seenEvents.errors], failedRequests: [...seenEvents.failed], clickError };
    steps.push(step);
    await session.quiet(() => page.screenshot({ path: path.join(runDir, `step-${String(i + 1).padStart(2, '0')}.png`) })).catch(() => {});

    const add = (rule, severity, detail) => {
      const f = { key: `${c.role}:${c.label}|${rule}`, rule, severity, element: `${c.role} "${c.label}"`, text: c.label, mode: 'flow', detail, step: i + 1 };
      findings.push(f);
      bus.emit('finding', { key: f.key, rule, severity, element: f.element, detail, mode: 'flow', rect });
    };
    if (clickError) add('click-failed', 'high', `could not click: ${clickError}`);
    if (step.errors.length) { const er = errorFindingRule(blockedNow); add(er.rule, er.severity, (er.rule === 'js-error' ? '' : 'while a cross-origin request was blocked by the tool: ') + step.errors[0]); }
    if (step.failedRequests.length) add('failed-request', 'high', step.failedRequests[0]);
    if (shouldReportDeadClick({ clickError, changed, errors: step.errors, active: c.active, selfLink: c.selfLink })) add('dead-click', 'medium', 'click produced no visible change (url, dialog, DOM or state)');
    bus.emit('control.result', { n: i + 1, label: c.label, changed, dialogOpened: step.dialogOpened, errors: step.errors.length, failedRequests: step.failedRequests.length, deadClick: findings.some((f) => f.step === i + 1 && f.rule === 'dead-click') });
  }

  let judged = findings;
  if (triage === 'claude') judged = await judge(findings, { meter, context: `Flow test of ${url}. "dead-click" means no URL/DOM/dialog change after clicking; some controls legitimately do nothing visible (copy, analytics).` });

  const byRule = {};
  for (const f of judged) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const exercised = steps.filter((x) => !x.skipped).length;
  const coverage = { controlsFound: seen.size, exercised, selfLinksNotCountedAsDead: steps.filter((x) => x.selfLink && !x.changed).length, crossOriginBlocked: [...blockedOrigins], skippedByRiskScreen: steps.filter((x) => x.skipped).length, skippedByLabelRule: [...seen].filter((k) => RISKY.test(k.split('|')[1]) && ![...visited].includes(k)).length, stopReason };
  const counted = judged.filter(countsAsDefect);
  const status = counted.length ? 'defects' : 'pass';
  const distinct = uniqueCounted(judged).length;
  bus.emit('run.result', { status, findings: distinct });
  if (headed && pace) await sleep(1800); // hold the final banner on screen for whoever is watching
  const summary = meter.finish();
  const { video } = await session.close();
  writeReport(runDir, { stamp: stamp(P.root), url, kind: 'flow', byRule, outcome: { status, counted: counted.length }, violations: judged, steps, coverage });
  const exitCode = counted.length ? EXIT.DEFECTS : EXIT.PASS;
  bus.emit('run.end', { status, exitCode, totalMs: summary.totalMs, totalUsd: summary.totalUsd, findings: distinct, findingsRaw: counted.length, byRule, coverage, video });
  return { status, exitCode, runDir, runId, url, findings: judged, counted, byRule, coverage, steps, summary, video };
}
