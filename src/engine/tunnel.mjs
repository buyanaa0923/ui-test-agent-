// tunnel: click through an app's interactive controls one by one ("tunnelling") and record what each click did.
// Reports dead buttons, JS errors, failed requests, and clicks that navigate somewhere broken (HTTP error, blank page,
// "not found", a login wall). With depth > 0 it follows the pages its clicks reach: each new same-origin page is queued
// and explored the same way, breadth first, up to `depth` clicks from the start page. A picker (heuristic or Jev)
// chooses the next control; a risk screen (Jev, then Claude) decides whether a control is safe to click.
// With checkDesign, every page is also measured against the design contract (the same checks as dig) as soon as it is
// entered, before any click changes it; a shell element that repeats on every page is one defect, judged once.
// With forms (off by default), each form is filled with obvious test data after the clicks: 'fill' never sends it,
// 'submit' does, only against dev hosts, and writes every submission to submissions.jsonl (see forms.mjs).
// Pure engine: events out, result back.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P } from '../core/paths.mjs';
import { createRun, writeReport } from '../core/run.mjs';
import { EventBus } from '../core/events.mjs';
import { EXIT, NotRunError, UsageError } from '../core/errors.mjs';
import { stamp } from '../core/stamp.mjs';
import { toSsoRegex } from './browser.mjs';
import { openSession } from './session.mjs';
import { loadChecked } from './guard.mjs';
import { makePicker } from '../models/jev.mjs';
import { judge } from '../models/judge.mjs';
import { makeCascade } from '../models/cascade.mjs';
import { shouldReportDeadClick, dropToolCausedErrors, isAllowedRequest, errorFindingRule, dropNavLoadErrors, routeKey, pathOf, sameOrigin, isRiskyPath, isRiskyLabel, isAuthPath, arrivalProblem } from './flow-rules.mjs';
import { countsAsDefect } from './dig.mjs';
import { badIgnoreSelector, preparePage, measureModes, judgeDesign } from './measure.mjs';
import { resolveContract, contractSummary, VIEWPORTS, ContractError } from './contract.mjs';
import { createLocator, projectRoot } from './locate.mjs';
import { styleOutliers } from './fingerprint.mjs';
import { isSandboxHost, sensitiveReason, testValue, submitOutcome, findForms, formState } from './forms.mjs';
import { uniqueCounted } from '../core/findings.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Controls in the app's chrome are the same control on every page: tested once per run, not once per page.
const CHROME = 'nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]';
const DIALOG = '[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]';
// Inside a dialog, the button that commits it (creates, saves, sends, confirms) is never clicked: Mole opens dialogs to
// test them, it does not fill them in. English and Mongolian (хадгалах save, илгээх send, үүсгэх create, батлах confirm,
// нэмэх add, тийм yes).
const DIALOG_COMMIT = /\b(save|submit|create|confirm|send|apply|ok|yes|done|add|publish|approve)\b|хадгал|илгээ|үүсгэ|батал|нэмэх|тийм/i;
const rawKey = (c) => `${c.role}|${c.label}`;

export async function tunnel(opts, ctx = {}) {
  const {
    url, max = 20, depth: maxDepth = 0, maxPages = 10, maxPerPage = maxDepth > 0 ? 10 : max,
    name = 'flow', picker = process.env.PICKER || 'heuristic', riskScreen: riskOpt = false,
    triage = 'none', // 'none' | 'claude'
    allowOrigins = [], storageState = null, ssoButton = null, headed = false, record = false, pace = 500,
    // states without a URL: dialogs, tab panels, accordions, menus a click opens, explored up to stateDepth clicks deep
    stateDepth = 0, maxStates = 6,
    // forms: 'off' | 'fill' | 'submit'; submit only against dev hosts or ones named in submitHosts, at most maxSubmits
    forms = 'off', submitHosts = [], maxSubmits = 5,
    // design checks on every page (dig's rules): the contract, colour modes, the judge for design findings, source mapping
    checkDesign = false, design = null, platform = null, modes = ['light', 'dark'], designTriage = 'none', root = null, locate = true,
  } = opts;
  if (!['off', 'fill', 'submit'].includes(forms)) throw new UsageError(`forms must be off, fill or submit (got "${forms}")`);
  // Submitting creates real records in the app: refuse before anything starts unless the host is a dev host.
  if (forms === 'submit' && !isSandboxHost(new URL(url).hostname, submitHosts)) {
    const host = new URL(url).hostname;
    throw new UsageError(`--forms submit creates data in the app, so it only runs against a local dev host (localhost, 127.0.0.1, *.localhost, *.test). "${host}" is not one; if it is a test environment you control, allow it with --submit-host ${host}.`);
  }
  // Resolve the contract before anything starts: a broken design.md is a usage error, not a page defect.
  const contract = checkDesign ? opts.contract || resolveContract({ design, platform }) : null;
  const viewport = opts.viewport || (contract ? VIEWPORTS[contract.platform] : { width: 1280, height: 800 });
  const designFile = contract?.sources.find((x) => x.kind === 'design')?.path;
  const locator = contract && locate ? createLocator({ url, root: root || process.env.MOLE_SRC_ROOT || (designFile ? projectRoot(path.dirname(designFile)) : process.env.MOLE_PROJECT_DIR || process.cwd()) }) : null;
  const bus = ctx.bus || new EventBus();
  const run = createRun({ name, bus, plannedSteps: max + 3, maxUsd: opts.maxUsd });
  const { runDir, meter, runId } = run;
  const riskScreen = picker === 'jev' || riskOpt;
  const tag = crypto.createHash('sha1').update(runId).digest('hex').slice(0, 6); // marks every value Mole types in this run
  bus.emit('run.start', { command: 'tunnel', url, max, depth: maxDepth, maxPages, stateDepth, forms, ...(forms !== 'off' ? { tag } : {}), runId, runDir, picker, riskScreen, triage, ...(contract ? { checkDesign: true, modes, designTriage, contract: contractSummary(contract) } : {}) });
  for (const message of contract?.notes || []) bus.emit('note', { message });

  const cascade = makeCascade({ meter, runDir, bus });
  const pick = makePicker({ kind: picker, meter, runDir, bus });
  const origin = new URL(url).origin;

  const finishNotRun = async (problem, session) => {
    await session?.close();
    const s = meter.finish();
    writeReport(runDir, { url, kind: 'flow', status: 'not_run', problem, ...(contract ? { contract: contractSummary(contract) } : {}), byRule: {}, violations: [], steps: [] });
    bus.emit('not_run', { problem });
    bus.emit('run.end', { status: 'not_run', exitCode: EXIT.NOT_RUN, totalMs: s.totalMs, totalUsd: s.totalUsd, findings: 0, byRule: {} });
    return { status: 'not_run', exitCode: EXIT.NOT_RUN, problem, runDir, runId, findings: [], byRule: {} };
  };

  let session;
  try {
    session = await openSession({ viewport, mobile: contract?.platform === 'mobile', headed, storageState, record, runDir, attach: ctx.attach, bus, meter });
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

  // What one click caused: errors, failed requests, failed page loads (nav), and the network it is still waiting on.
  const seenEvents = { errors: [], failed: [], nav: [], writes: [] };
  const net = { inflight: new Set(), navigated: false, navRequests: [] };
  const isMainNav = (req) => { try { return req.isNavigationRequest() && req.frame() === page.mainFrame(); } catch { return false; } };
  page.on('pageerror', (e) => seenEvents.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && seenEvents.errors.push(`console: ${m.text().slice(0, 160)}`));
  page.on('response', (r) => {
    let same = false; try { same = new URL(r.url()).origin === origin; } catch { /* not a URL we judge */ }
    const method = r.request().method();
    if (same && !['GET', 'HEAD', 'OPTIONS'].includes(method)) seenEvents.writes.push({ method, path: r.url().replace(origin, ''), status: r.status() }); // what a submit sent
    if (r.status() < 400 || !same) return;
    if (isMainNav(r.request())) seenEvents.nav.push({ url: r.url(), status: r.status() }); // judged as the landing page, not as a request
    else seenEvents.failed.push(`${r.status()} ${r.url().replace(origin, '')}`);
  });
  page.on('request', (r) => { if (r.resourceType() !== 'eventsource') net.inflight.add(r); if (isMainNav(r)) net.navRequests.push(r.url()); });
  page.on('requestfinished', (r) => net.inflight.delete(r));
  page.on('requestfailed', (r) => net.inflight.delete(r));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) net.navigated = true; });

  const resetSeen = () => { for (const k of Object.keys(seenEvents)) seenEvents[k].length = 0; blockedNow = 0; net.inflight.clear(); net.navigated = false; net.navRequests.length = 0; };
  // Wait for what a click started instead of a fixed pause: the requests it made finish, a navigation it caused loads.
  // Capped, so an app that polls forever costs a few seconds per click, not a hang.
  const quietNetwork = async (capMs) => {
    const end = Date.now() + capMs; let since = null;
    while (Date.now() < end) {
      if (net.inflight.size === 0) { since ??= Date.now(); if (Date.now() - since >= 250) return; } else since = null;
      await page.waitForTimeout(50).catch(() => {});
    }
  };
  const settle = async () => {
    await page.waitForTimeout(300).catch(() => {});
    await quietNetwork(2500);
    if (net.navigated) { await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {}); await quietNetwork(2500); }
  };

  // Runs in the page: the visible controls, numbered (data-uta) so they can be clicked, and the dialog on top, if any.
  const enumerate = () => page.evaluate(({ chrome, dialogSel }) => {
    document.querySelectorAll('[data-uta]').forEach((e) => e.removeAttribute('data-uta'));
    // checkVisibility also sees content hidden by content-visibility, e.g. inside a closed <details>, which still has a size
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 4 && r.height >= 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true })); };
    const dialogs = [...document.querySelectorAll(dialogSel)].filter(shown);
    const top = dialogs.at(-1) || null;
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const dialogName = top ? (top.getAttribute('aria-label') || text(document.getElementById(top.getAttribute('aria-labelledby') || '')) || text(top.querySelector('h1, h2, h3, h4, [role=heading]'))).slice(0, 40) : null;
    const sel = 'button, a[href], [role=button], [role=tab], [role=menuitem], summary, input[type=checkbox], input[type=radio], [role=switch]';
    const out = [];
    document.querySelectorAll(sel).forEach((el) => {
      if (!shown(el)) return;
      const href = el.getAttribute('href') || '';
      if (/^(https?:)?\/\//.test(href) && !href.startsWith(location.origin)) return; // external
      const role = el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase());
      const label = (el.getAttribute('aria-label') || el.textContent || el.labels?.[0]?.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50) || '(no name)';
      el.setAttribute('data-uta', String(out.length));
      const active = ['aria-selected', 'aria-current', 'aria-pressed'].some((a) => ['true', 'page'].includes(el.getAttribute(a)));
      let selfLink = false, target = '';
      if (el.tagName === 'A' && href && !href.startsWith('#')) { try { const u = new URL(el.href, location.href); target = u.pathname + u.search; selfLink = u.origin === location.origin && u.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '') && u.search === location.search; } catch { /* keep false */ } }
      out.push({
        id: out.length, role, label, active, selfLink, target,
        global: !!el.closest(chrome) && !el.closest(dialogSel), // a dialog's own header/footer is part of the dialog
        inDialog: !!top && top.contains(el),
        submits: el.tagName === 'BUTTON' && el.type === 'submit' && !!el.form, // clicking it would submit a form
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
      });
    });
    return { controls: out, dialogs: dialogs.length, dialog: dialogName };
  }, { chrome: CHROME, dialogSel: DIALOG });

  // Runs in the page: the region a click opened, for the design checks. A dialog is the dialog on top; a tab or an
  // expander is what its aria-controls names, or the <details> of a <summary>. mark=true tags it data-mole-scope.
  const region = (kind, id, mark) => page.evaluate(({ kind, id, mark, dialogSel }) => {
    if (mark) document.querySelectorAll('[data-mole-scope]').forEach((e) => e.removeAttribute('data-mole-scope'));
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 4 && r.height >= 4 && getComputedStyle(el).visibility !== 'hidden'; };
    let r = null;
    if (kind === 'dialog') r = [...document.querySelectorAll(dialogSel)].filter(shown).at(-1) || null;
    else {
      const el = document.querySelector(`[data-uta="${id}"]`);
      const ctl = (el?.getAttribute('aria-controls') || '').split(/\s+/)[0];
      r = (ctl && document.getElementById(ctl)) || (el?.tagName === 'SUMMARY' ? el.parentElement : null);
      if (r && !shown(r)) r = null;
    }
    if (r && mark) r.setAttribute('data-mole-scope', '');
    return !!r;
  }, { kind, id, mark, dialogSel: DIALOG }).catch(() => false);

  const snapshot = () => page.evaluate(() => {
    const str = document.body.innerText + '|' + document.documentElement.className + '|' + document.documentElement.lang;
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    return {
      url: location.pathname + location.search + location.hash,
      href: location.href,
      dialogs: [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]')].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; }).length, // open ones: many apps keep closed dialogs in the DOM
      hash: hash + '/' + document.querySelectorAll('*').length,
      scroll: Math.round(scrollY / 50),
      expanded: [...document.querySelectorAll('[aria-expanded="true"],[aria-selected="true"],[aria-checked="true"]')].length
        + document.querySelectorAll('input:checked, option:checked').length * 1000, // native boxes change only their :checked state
    };
  });
  // A click that navigates can destroy the page context mid-read: wait for the new page and read again.
  const snap = async () => { try { return await snapshot(); } catch { await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {}); return snapshot(); } };

  // The page a click landed on, read the way guard.mjs reads a fresh load. A SPA may still be rendering: give it 2 s.
  const probeArrival = async () => {
    const read = () => page.evaluate(() => ({
      title: document.title, headings: [...document.querySelectorAll('h1, h2')].slice(0, 5).map((h) => h.innerText.trim().slice(0, 120)),
      elements: document.querySelectorAll('body *').length, text: (document.body?.innerText || '').slice(0, 3000),
    })).catch(() => null);
    let p = await read();
    for (let i = 0; i < 8 && p && p.elements < 5; i++) { await page.waitForTimeout(250); p = await read(); }
    return p;
  };

  let h = meter.start('load', { url });
  const sso = toSsoRegex(ssoButton);
  const loaded = await loadChecked(page, url, { ssoButton: sso });
  meter.end(h);
  if (!loaded.ok) return finishNotRun(loaded.problem, session);
  bus.emit('page.loaded', { url, elements: loaded.elements });

  const visited = new Set();
  const seen = new Set();
  const riskyPaths = new Set();
  const steps = [];
  const findings = [];
  const designFindings = [];
  const skippedSubmit = new Set(), skippedCommit = new Set(), skippedLabel = new Set();
  const formRows = [], formSigs = new Set();
  let submits = 0, submitsBeyondCap = 0;
  const ledger = path.join(runDir, 'submissions.jsonl');
  let statesBeyondCap = 0;
  // The page queue, breadth first. `known` holds every route already queued, so a page is explored once.
  const pages = [{ url, path: pathOf(url), depth: 0, from: null }];
  const known = new Set([routeKey(url), routeKey(page.url())]);
  const beyondDepth = new Set();
  const authPagesNotExplored = new Set();
  let n = 0;
  let stopReason = null;

  pages: for (let pi = 0; pi < pages.length; pi++) {
    const pg = pages[pi];
    if (n >= max) { stopReason = 'max-steps'; break; }
    if (pi >= maxPages) { stopReason = 'max-pages'; break; }
    Object.assign(pg, { controls: 0, exercised: 0, stop: null });
    if (pi > 0) {
      h = meter.start(`enter-${pi + 1}`, { url: pg.url });
      const entered = await loadChecked(page, pg.url, { ssoButton: sso });
      meter.end(h);
      if (!entered.ok) { // it opened by clicking but not by URL: note it, the click that reached it was already judged
        Object.assign(pg, { stop: 'not-entered', problem: entered.problem });
        bus.emit('note', { message: `could not open ${pg.path} directly: ${entered.problem}` });
        continue;
      }
    }
    bus.emit('page.enter', { n: pi + 1, url: pg.url, path: pg.path, depth: pg.depth, from: pg.from, queued: pages.length - pi - 1 });
    let fresh = true;
    if (contract) { // measured as the page first renders, before any click opens or changes something
      if (pi === 0) { const bad = await badIgnoreSelector(page, contract); if (bad) { await session.close(); throw new ContractError(`ignore entry "${bad}" is not a valid CSS selector`); } }
      const stretched = await preparePage(page, { viewport, bus });
      locator?.setPage(pg.url);
      const nn = String(pi + 1).padStart(2, '0');
      const m = await measureModes({
        page, session, contract, modes, bus, meter, locator, runDir, headed, pace, extra: { page: pg.path },
        // the start page keeps dig's keys; later pages scope them, while the element and measurement (what groups
        // findings into one defect) stay the same, so a shell element on every page is still one defect
        decorate: (f) => ({ ...f, key: pi === 0 ? f.key : `${pg.path} ${f.key}`, page: pg.path }),
        shot: (mode) => `page-${nn}-${mode}.png`, stage: (x) => `p${pi + 1}-${x}`,
      });
      designFindings.push(...m.findings);
      Object.assign(pg, { elements: m.elements, designFindings: m.findings.length, modesSkipped: m.skipped, fingerprint: m.fingerprint });
      bus.emit('page.measured', { n: pi + 1, path: pg.path, elements: m.elements, findings: m.findings.length, skipped: m.skipped });
      // back to how the app renders by default, and reload before the first click: the clicks must see what a user sees
      await page.emulateMedia({ colorScheme: null }).catch(() => {});
      if (stretched) await page.setViewportSize(viewport).catch(() => {});
      fresh = false;
    }
    // A page is explored as a queue of states: the page as it loads, then each dialog, tab panel, accordion or menu a
    // click opened (reached again by reloading the page and replaying the clicks, since it has no URL of its own).
    const base = { id: '', kind: 'page', via: [], label: null, depth: 0, reveals: null };
    pg.states = [base];
    const stateSigs = new Set();

    // Back to a state's clean start: reload the page, replay the clicks that open the state, check it really opened,
    // and tag its region for the design checks.
    const resetTo = async (st) => {
      if (sso) { // token lives in memory only: every fresh load needs the sign-in step again; losing the session ends the run loudly
        const again = await loadChecked(page, pg.url, { ssoButton: sso });
        if (!again.ok) return { lost: again.problem };
      } else {
        // SPAs render after load (lazy routes, federated modules): wait for the requests the load started and for
        // something on screen, as the first load did. A page still blank after that is a failed replay, never a page
        // with nothing left to click.
        net.inflight.clear();
        await page.goto(pg.url, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        await quietNetwork(5000);
        const count = () => page.evaluate(() => document.querySelectorAll('body *').length).catch(() => 0);
        let els = await count();
        for (let i = 0; i < 20 && els < 5; i++) { await page.waitForTimeout(250); els = await count(); }
        if (els < 5) return { failed: `${pg.path} rendered only ${els} element(s) when reloaded` };
      }
      if (!st.via.length) return { ok: true };
      await page.waitForTimeout(250);
      let lastId = null;
      for (const v of st.via) {
        const e = await session.quiet(enumerate);
        const same = (v.scope === 'dialog' ? e.controls.filter((x) => x.inDialog) : e.controls).filter((x) => rawKey(x) === v.key);
        const c = same[v.nth] || same[0];
        if (!c) return { failed: `${v.key.replace('|', ' "')}" was not there to open ${st.label} again` };
        net.inflight.clear(); net.navigated = false;
        try { await page.locator(`[data-uta="${c.id}"]`).first().click({ timeout: 3000 }); } catch (err) { return { failed: `could not click ${v.key.replace('|', ' "')}" again: ${err.message.split('\n')[0].slice(0, 80)}` }; }
        await settle();
        lastId = c.id;
      }
      const hasRegion = await region(st.kind, lastId, true);
      const e = await session.quiet(enumerate);
      const open = st.kind === 'dialog' ? e.dialogs > 0 : st.reveals.some((k) => e.controls.some((x) => rawKey(x) === k)) || hasRegion;
      return open ? { ok: true, region: hasRegion } : { failed: `replaying the clicks did not open ${st.label} again` };
    };

    // Forms in a state, one at a time from its clean start: fill each with test data; with 'submit', send it and judge
    // the answer. Forms in the app chrome (a header search) are tested once per run.
    const testForms = async (st, nameOf) => {
      const scope = st.kind === 'dialog' ? 'dialog' : st.kind === 'reveal' ? (st.hasRegion ? 'region' : null) : 'page';
      if (!scope) return null;
      for (;;) {
        if (n >= max) return null;
        const r = await resetTo(st);
        if (r.lost) return { lost: r.lost };
        if (!r.ok) return null;
        await page.waitForTimeout(250);
        const all = await session.quiet(() => findForms(page, { scope, chrome: CHROME, dialogSel: DIALOG, commit: DIALOG_COMMIT }));
        const sigOf = (f) => `${f.global ? '' : pg.path + st.id}|${f.name}|${f.fields.map((x) => x.name || x.label).join(',')}`;
        const f = all.find((x) => !formSigs.has(sigOf(x)));
        if (!f) return null;
        formSigs.add(sigOf(f));
        const where = { page: pg.path, ...(st.label ? { state: st.label } : {}) };
        const element = nameOf({ role: 'form', label: f.name, global: f.global });
        const row = { ...where, form: f.name, element, fields: [], submit: f.submit?.label || null, mode: forms, outcome: null };
        formRows.push(row);
        const sensitive = sensitiveReason(f.fields);
        if (sensitive) { // never filled, in any mode
          Object.assign(row, { outcome: 'skipped', reason: `sensitive form: ${sensitive}` });
          bus.emit('form.result', { ...where, name: f.name, skipped: row.reason });
          continue;
        }
        n++;
        const key = (rule) => `${f.global ? '' : st.kind !== 'page' ? `${pg.path}${st.id} ` : pi === 0 ? '' : `${pg.path} `}form:${f.name}|${rule}`;
        const add = (rule, severity, detail) => {
          const x = { key: key(rule), rule, severity, element, text: f.name, mode: 'flow', detail, step: n, ...where };
          findings.push(x);
          bus.emit('finding', { key: x.key, rule, severity, element, detail, mode: 'flow', ...where });
        };
        h = meter.start(`form-${n}`, { form: f.name, ...where });
        bus.emit('form.fill', { n, name: f.name, fields: f.fields.length, submit: f.submit?.label || null, ...where });
        resetSeen();
        const refused = [];
        for (const fld of f.fields) {
          const v = testValue(fld, { tag });
          const field = fld.label || fld.name || fld.type;
          if (v.skip) { row.fields.push({ field, skipped: v.skip }); continue; }
          const loc = page.locator(`[data-mole-field="${fld.fid}"]`).first();
          try {
            if (v.check) await loc.check({ timeout: 2000 });
            else if (v.select != null) await loc.selectOption(v.select, { timeout: 2000 });
            else await loc.fill(v.value, { timeout: 2000 });
            const got = v.value != null ? await loc.inputValue().catch(() => '') : 'set';
            if (!got) refused.push(field);
            row.fields.push({ field, value: v.value ?? v.select ?? 'checked', ...(v.mismatch ? { patternMismatch: true } : {}) });
          } catch (e) { refused.push(field); row.fields.push({ field, error: e.message.split('\n')[0].slice(0, 80) }); }
        }
        await settle();
        const typing = dropToolCausedErrors(dropNavLoadErrors(seenEvents.errors, seenEvents.failed.length), blockedNow).errors;
        if (refused.length) add('field-refuses-input', 'medium', `could not type into ${refused.map((x) => `"${x}"`).join(', ')}`);
        if (typing.length) add('js-error', 'high', `while typing test data: ${typing[0]}`);
        if (seenEvents.failed.length) add('failed-request', 'high', `while typing test data: ${seenEvents.failed[0]}`);
        const state = await formState(page, f.fid);
        if (f.submit && state.valid && state.submitDisabled && !refused.length) add('submit-stays-disabled', 'medium', `every field filled with valid test data, "${f.submit.label}" is still disabled`);
        row.valid = state.valid; if (state.invalid.length) row.invalid = state.invalid;

        // Submit, only when asked, when there is something to submit with, and within the cap.
        const why = forms !== 'submit' ? 'fill only' : !f.submit ? 'no submit button' : state.submitDisabled ? 'submit button disabled' : !state.valid ? `Mole could not produce valid data for ${state.invalid.join(', ')}` : isRiskyLabel(f.submit.label) ? `risky label "${f.submit.label}"` : submits >= maxSubmits ? `submit cap (${maxSubmits}) reached` : null;
        if (why?.startsWith('submit cap')) submitsBeyondCap++; // only forms the cap alone kept back
        let screened = null;
        if (!why && riskScreen) { screened = await cascade.screenRisk({ label: f.submit.label, role: 'button', context: `submits the form "${f.name}"` }); }
        if (why || screened?.risky) {
          Object.assign(row, { outcome: 'filled', ...(forms === 'submit' ? { notSubmitted: why || `risk screen (${screened.by})` } : {}) });
        } else {
          const before = await snap();
          resetSeen();
          let clickError = null;
          try { await page.locator(`[data-mole-submit="${f.fid}"]`).first().click({ timeout: 3000 }); } catch (e) { clickError = e.message.split('\n')[0].slice(0, 120); }
          await settle();
          submits++;
          const errs = dropToolCausedErrors(dropNavLoadErrors(seenEvents.errors, seenEvents.nav.length + seenEvents.failed.length), blockedNow).errors;
          const after = clickError ? before : await snap();
          const toKey = routeKey(after.href);
          const landed = !clickError && toKey !== routeKey(before.href) && sameOrigin(after.href, origin) ? pathOf(after.href) : null;
          const arrived = landed ? arrivalProblem({ status: seenEvents.nav.at(-1)?.status ?? null, requestedUrl: net.navRequests[0], finalUrl: after.href, probe: await probeArrival() }) : null;
          const changed = before.url !== after.url || before.dialogs !== after.dialogs || before.hash !== after.hash || before.expanded !== after.expanded;
          const writes = [...seenEvents.writes];
          const out = clickError ? { outcome: 'defect', rule: 'click-failed', severity: 'high', detail: `could not click "${f.submit.label}": ${clickError}` } : submitOutcome({ writes, landed, changed });
          if (out.rule) add(out.rule, out.severity, out.detail);
          if (arrived) add(arrived.rule, arrived.severity, arrived.detail);
          if (errs.length) add('js-error', 'high', `after submitting: ${errs[0]}`);
          const others = seenEvents.failed.filter((x) => !writes.some((w) => `${w.status} ${w.path}` === x));
          if (others.length) add('failed-request', 'high', `after submitting: ${others[0]}`);
          Object.assign(row, { outcome: out.outcome === 'defect' ? 'failed' : out.outcome === 'rejected' ? 'rejected' : 'submitted', detail: out.detail, writes, navigatedTo: landed });
          fs.appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), runId, tag, url: pg.url, ...where, form: f.name, submit: f.submit.label, fields: row.fields, writes, outcome: row.outcome }) + '\n');
        }
        meter.end(h);
        steps.push({ n, ...where, kind: 'form', target: element, fields: row.fields.length, submitted: ['submitted', 'failed', 'rejected'].includes(row.outcome), outcome: row.outcome, changed: true, errors: [], failedRequests: [] });
        await session.quiet(() => page.screenshot({ path: path.join(runDir, `step-${String(n).padStart(2, '0')}.png`) })).catch(() => {});
        bus.emit('form.result', { n, ...where, name: f.name, filled: row.fields.filter((x) => x.value != null).length, submitted: steps.at(-1).submitted, outcome: row.outcome, detail: row.detail || row.notSubmitted || null, problem: findings.some((x) => x.step === n) ? findings.filter((x) => x.step === n).map((x) => x.rule).join(', ') : null });
      }
    };

    for (let si = 0; si < pg.states.length; si++) {
      const st = pg.states[si];
      if (n >= max) { stopReason = 'max-steps'; break pages; }
      Object.assign(st, { controls: 0, exercised: 0, stop: null });
      if (si > 0) {
        h = meter.start(`state-${pi + 1}.${si}`, { page: pg.path, state: st.label });
        const r = await resetTo(st);
        meter.end(h);
        if (r.lost) { st.stop = 'session-lost'; stopReason = `session-lost: ${r.lost}`; break pages; }
        if (!r.ok) { Object.assign(st, { stop: 'replay-failed', problem: r.failed }); bus.emit('note', { message: `${pg.path}: ${r.failed}` }); continue; }
        st.hasRegion = !!r.region;
        bus.emit('state.enter', { page: pg.path, label: st.label, kind: st.kind, depth: st.depth, from: st.from, queued: pg.states.length - si - 1 });
        fresh = true;
        if (contract && r.region) { // the dialog or panel alone: the page behind it was measured already
          const nn = `${String(pi + 1).padStart(2, '0')}-s${si}`;
          const m = await measureModes({
            page, session, contract, modes, bus, meter, locator, runDir, headed, pace, within: '[data-mole-scope]', extra: { page: pg.path, state: st.label },
            decorate: (f) => ({ ...f, key: `${pg.path}${st.id} ${f.key}`, page: pg.path, state: st.label }),
            shot: (mode) => `page-${nn}-${mode}.png`, stage: (x) => `p${pi + 1}s${si}-${x}`,
          });
          designFindings.push(...m.findings);
          Object.assign(st, { elements: m.elements, designFindings: m.findings.length, modesSkipped: m.skipped });
          bus.emit('page.measured', { n: pi + 1, path: pg.path, state: st.label, elements: m.elements, findings: m.findings.length, skipped: m.skipped });
          await page.emulateMedia({ colorScheme: null }).catch(() => {});
          fresh = false;
        }
      }
      // Keys: app chrome is one control for the whole run; on the start page a control keeps its pre-depth key; on
      // other pages and inside states the key names where it is, so the same "Edit" or "Close" in two places is two.
      const scoped = (x) => !x.global && (st.kind !== 'page' || pi > 0);
      const keyOf = (x) => (x.global ? '' : st.kind !== 'page' ? `${pg.path}${st.id}#` : pi === 0 ? '' : `${pg.path}#`) + rawKey(x);
      const findingPrefix = (x) => (x.global ? '' : st.kind !== 'page' ? `${pg.path}${st.id} ` : pi === 0 ? '' : `${pg.path} `);
      const nameOf = (x) => `${x.role} "${x.label}"${!x.global && st.kind !== 'page' ? ` in ${st.label}` : ''}${!x.global && pi > 0 ? ` on ${pg.path}` : ''}`;
      const stateKeys = new Set();
      let onState = 0;

      for (;;) {
        if (n >= max) { st.stop = 'max-steps'; break; }
        if (onState >= maxPerPage) { st.stop = 'max-per-page'; break; }
        if (!fresh) {
          const r = await resetTo(st);
          if (r.lost) { st.stop = 'session-lost'; stopReason = `session-lost: ${r.lost}`; break pages; }
          if (!r.ok) { Object.assign(st, { stop: 'replay-failed', problem: r.failed }); bus.emit('note', { message: `${pg.path}: ${r.failed}` }); break; }
        }
        fresh = false;
        await page.waitForTimeout(250);
        const seenNow = await session.quiet(enumerate);
        const inState = st.kind === 'dialog' ? seenNow.controls.filter((x) => x.inDialog) : st.kind === 'reveal' ? seenNow.controls.filter((x) => st.reveals.includes(rawKey(x))) : seenNow.controls;
        const cands = inState.map((x) => {
          const key = keyOf(x);
          const pathRisk = x.role === 'link' && isRiskyPath(x.target);
          const commit = x.inDialog && DIALOG_COMMIT.test(x.label);
          if (pathRisk) riskyPaths.add(key);
          if (x.submits) skippedSubmit.add(key);
          if (commit) skippedCommit.add(key);
          const labelRisk = isRiskyLabel(x.label);
          if (labelRisk) skippedLabel.add(key);
          return { ...x, key, visited: visited.has(key) || x.disabled || labelRisk || pathRisk || x.submits || commit };
        });
        cands.forEach((x) => { seen.add(x.key); stateKeys.add(x.key); });
        st.controls = stateKeys.size;
        bus.emit('control.found', { count: seen.size, onPage: cands.length, page: pg.path, state: st.label });
        if (!cands.some((x) => !x.visited)) { st.stop = 'all-controls-tested'; break; }
        const p = await pick({ goal: `Exercise every distinct control ${st.label ? `in ${st.label} ` : ''}on ${pg.path}`, candidates: cands });
        if (p.choice == null || p.choice < 0 || !cands[p.choice] || cands[p.choice].visited) { st.stop = 'picker-returned-no-usable-choice'; break; }
        const c = cands[p.choice];
        visited.add(c.key);
        n++; onState++;
        const loc = page.locator(`[data-uta="${c.id}"]`).first();
        const rect = await loc.boundingBox().catch(() => null);
        const where = { page: pg.path, ...(st.label ? { state: st.label } : {}) };
        bus.emit('control.pick', { n, role: c.role, label: c.label, by: p.source, confidence: p.confidence, rect, ...where });
        if (riskScreen) {
          const rs = await cascade.screenRisk(c);
          if (rs.risky) {
            steps.push({ n, ...where, target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence, skipped: `risk screen (${rs.by})`, changed: false, errors: [], failedRequests: [] });
            bus.emit('control.result', { n, label: c.label, ...where, skipped: `risk screen (${rs.by})` });
            fresh = true; // nothing was clicked: the state is still clean
            continue;
          }
        }

        h = meter.start(`click-${n}`, { target: `${c.role} "${c.label}"`, ...where, pickedBy: p.source, confidence: p.confidence });
        const before = await snap();
        bus.emit('control.click', { n, role: c.role, label: c.label, rect });
        if (headed && pace) await sleep(pace); // let the overlay's mole walk to the control; headless runs never wait
        resetSeen();
        let clickError = null;
        try { await loc.click({ timeout: 3000 }); } catch (e) { clickError = e.message.split('\n')[0].slice(0, 120); }
        await settle();
        const filtered = dropToolCausedErrors(dropNavLoadErrors(seenEvents.errors, seenEvents.nav.length + seenEvents.failed.length), blockedNow);
        seenEvents.errors.splice(0, seenEvents.errors.length, ...filtered.errors);
        const after = clickError ? before : await snap();

        // Did it land somewhere? Only a new same-origin route is a landing; the page it lands on must be a real page.
        const toKey = routeKey(after.href);
        const landed = !clickError && toKey !== routeKey(before.href) && sameOrigin(after.href, origin) ? pathOf(after.href) : null;
        const arrived = landed ? arrivalProblem({ status: seenEvents.nav.at(-1)?.status ?? null, requestedUrl: net.navRequests[0], finalUrl: after.href, probe: await probeArrival() }) : null;
        const changed = before.url !== after.url || before.dialogs !== after.dialogs || before.hash !== after.hash || before.scroll !== after.scroll || before.expanded !== after.expanded;

        // Did it open something without a URL? A dialog, or controls / a region that were not on screen before.
        let opened = null;
        if (st.depth < stateDepth && changed && !landed && !clickError) {
          const hasRegion = await region('reveal', c.id, false); // read before re-numbering: c.id is still the clicked control
          const now = await session.quiet(enumerate);
          const had = new Set(seenNow.controls.map(rawKey));
          if (now.dialogs > seenNow.dialogs) opened = { kind: 'dialog', label: `dialog "${now.dialog || c.label}"`, keys: [...new Set(now.controls.filter((x) => x.inDialog).map(rawKey))] };
          else {
            const keys = [...new Set(now.controls.filter((x) => !x.global && !had.has(rawKey(x))).map(rawKey))];
            if (keys.length || hasRegion) opened = { kind: 'reveal', label: `${c.role} "${c.label}" open`, keys };
          }
        }
        meter.end(h);

        const step = { n, ...where, target: `${c.role} "${c.label}"`, pickedBy: p.source, confidence: p.confidence, selfLink: !!c.selfLink, before: before.url, after: after.url, navigatedTo: landed, dialogOpened: after.dialogs > before.dialogs, opened: opened?.label || null, changed, errors: [...seenEvents.errors], failedRequests: [...seenEvents.failed], clickError };
        steps.push(step);
        st.exercised++;
        await session.quiet(() => page.screenshot({ path: path.join(runDir, `step-${String(n).padStart(2, '0')}.png`) })).catch(() => {});

        const add = (rule, severity, detail) => {
          const f = { key: `${findingPrefix(c)}${c.role}:${c.label}|${rule}`, rule, severity, element: nameOf(c), text: c.label, mode: 'flow', detail, step: n, ...where };
          findings.push(f);
          bus.emit('finding', { key: f.key, rule, severity, element: f.element, detail, mode: 'flow', rect, ...where });
        };
        if (clickError) add('click-failed', 'high', `could not click: ${clickError}`);
        if (arrived) add(arrived.rule, arrived.severity, arrived.detail);
        if (step.errors.length) { const er = errorFindingRule(blockedNow); add(er.rule, er.severity, (er.rule === 'js-error' ? '' : 'while a cross-origin request was blocked by the tool: ') + step.errors[0]); }
        if (step.failedRequests.length) add('failed-request', 'high', step.failedRequests[0]);
        if (shouldReportDeadClick({ clickError, changed, errors: step.errors, active: c.active, selfLink: c.selfLink })) add('dead-click', 'medium', 'click produced no visible change (url, dialog, DOM or state)');
        bus.emit('control.result', { n, label: c.label, ...where, changed, navigatedTo: landed, opened: opened?.label || null, problem: arrived?.rule || null, dialogOpened: step.dialogOpened, errors: step.errors.length, failedRequests: step.failedRequests.length, deadClick: findings.some((f) => f.step === n && f.rule === 'dead-click') });

        // A healthy new page joins the page queue, one level deeper than the page whose control reached it.
        if (landed && !arrived && !known.has(toKey)) {
          known.add(toKey);
          if (isAuthPath(after.href)) authPagesNotExplored.add(landed);
          else if (pg.depth >= maxDepth) beyondDepth.add(landed);
          else {
            const from = `${c.role} "${c.label}" on ${pg.path}`;
            pages.push({ url: after.href, path: landed, depth: pg.depth + 1, from });
            bus.emit('page.found', { path: landed, depth: pg.depth + 1, from, queued: pages.length - pi - 1 });
          }
        }
        // A new state joins this page's state queue. The same dialog opened from twenty table rows is one state.
        if (opened) {
          const sig = `${opened.kind}|${opened.kind === 'dialog' ? opened.label : ''}|${opened.keys.length ? [...opened.keys].sort().join(',') : 'via ' + rawKey(c)}`;
          if (!stateSigs.has(sig)) {
            stateSigs.add(sig);
            if (pg.states.length - 1 >= maxStates) statesBeyondCap++;
            else {
              const scope = st.kind === 'dialog' ? 'dialog' : 'page';
              const nth = (scope === 'dialog' ? seenNow.controls.filter((x) => x.inDialog) : seenNow.controls).filter((x) => rawKey(x) === rawKey(c)).findIndex((x) => x.id === c.id);
              const from = `${c.role} "${c.label}"${st.label ? ` in ${st.label}` : ''}`;
              pg.states.push({ id: `${st.id} > ${rawKey(c)}${nth > 0 ? '#' + nth : ''}`, kind: opened.kind, label: opened.label, depth: st.depth + 1, via: [...st.via, { key: rawKey(c), nth: Math.max(nth, 0), scope }], reveals: opened.keys, from });
              bus.emit('state.found', { page: pg.path, label: opened.label, kind: opened.kind, depth: st.depth + 1, from });
            }
          }
        }
      }
      if (forms !== 'off' && st.stop !== 'replay-failed') { const f = await testForms(st, nameOf); if (f?.lost) { stopReason = `session-lost: ${f.lost}`; break pages; } }
      if (si === 0) Object.assign(pg, { controls: st.controls, exercised: st.exercised, stop: st.stop, ...(st.problem ? { problem: st.problem } : {}) });
    }
  }
  const statesOf = (x) => (x.states || []).slice(1);
  if (!stopReason) {
    const units = pages.flatMap((x) => [x, ...statesOf(x).filter((s) => s.stop)]);
    const stops = units.map((x) => x.stop).filter(Boolean);
    stopReason = stops.includes('max-steps') ? 'max-steps'
      : units.length === 1 ? pages[0].stop
      : stops.every((s) => ['all-controls-tested', 'not-entered', 'replay-failed'].includes(s)) ? 'all-controls-tested' : 'all-pages-visited';
  }

  let judged = findings;
  const designJudged = await judgeDesign(designFindings, { triage: designTriage, meter, runDir, bus, context: `Design-system scan of the pages reached from ${url} against the design contract "${contract?.name}" (${contract?.platform}). Contrast findings on text over images/gradients are skipped by the engine; the rest were measured from painted pixels.` });
  if (triage === 'claude') judged = await judge(findings, { meter, context: `Flow test of ${url}. "dead-click" means no URL/DOM/dialog change after clicking; some controls legitimately do nothing visible (copy, analytics). "broken-link", "blank-page", "not-found-page" and "lands-on-login" describe the page a click navigated to.` });

  judged = [...judged, ...designJudged];
  const byRule = {};
  for (const f of judged) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const exercised = steps.filter((x) => !x.skipped && x.kind !== 'form').length; // controls clicked; forms are counted on their own
  const row = ({ controls = 0, exercised: ex = 0, stop = null, problem = null, elements, designFindings: df, modesSkipped }) => ({ controls, exercised: ex, stop: stop || 'not-reached', ...(problem ? { problem } : {}), ...(elements != null ? { elements, designFindings: df, modesSkipped } : {}) });
  const pageRows = pages.map((x) => ({ path: x.path, depth: x.depth, from: x.from, ...row(x), ...(statesOf(x).length ? { states: statesOf(x).map((s) => ({ label: s.label, kind: s.kind, depth: s.depth, from: s.from, ...row(s) })) } : {}) }));
  const stateRows = pageRows.flatMap((x) => x.states || []);
  const coverage = {
    controlsFound: seen.size, exercised, selfLinksNotCountedAsDead: steps.filter((x) => x.selfLink && !x.changed).length, crossOriginBlocked: [...blockedOrigins],
    skippedByRiskScreen: steps.filter((x) => x.skipped).length, skippedByLabelRule: [...skippedLabel].filter((k) => !visited.has(k)).length,
    skippedByPathRule: [...riskyPaths].filter((k) => !visited.has(k)).length,
    skippedSubmit: [...skippedSubmit].filter((k) => !visited.has(k)).length, skippedDialogCommit: [...skippedCommit].filter((k) => !visited.has(k)).length,
    stateDepth, statesFound: stateRows.length + statesBeyondCap, statesExplored: stateRows.filter((x) => !['not-reached', 'replay-failed'].includes(x.stop)).length,
    statesNotReached: stateRows.filter((x) => x.stop === 'not-reached').length + statesBeyondCap, statesReplayFailed: stateRows.filter((x) => x.stop === 'replay-failed').length,
    statesDesignChecked: stateRows.filter((x) => x.elements != null).length,
    forms, formsFound: formRows.length, formsFilled: formRows.filter((x) => x.outcome !== 'skipped').length, formsSubmitted: formRows.filter((x) => ['submitted', 'failed', 'rejected'].includes(x.outcome)).length,
    formsSkippedSensitive: formRows.filter((x) => x.outcome === 'skipped').length, submitsBeyondCap,
    depth: maxDepth, pagesVisited: pageRows.filter((x) => !['not-reached', 'not-entered'].includes(x.stop)).length, pagesNotReached: pageRows.filter((x) => x.stop === 'not-reached').length,
    pagesBeyondDepth: [...beyondDepth], authPagesNotExplored: [...authPagesNotExplored], pagesDesignChecked: pageRows.filter((x) => x.elements != null).length, pages: pageRows, stopReason,
  };
  // Style consistency across the pages reached: advisory, never part of the defects or the exit code.
  const consistency = contract ? styleOutliers(pages.filter((x) => x.fingerprint).map((x) => ({ path: x.path, fp: x.fingerprint }))) : null;
  if (consistency) coverage.styleOutliers = consistency.checked ? consistency.outliers.length : null;
  if (consistency) bus.emit('consistency', { checked: consistency.checked, pages: consistency.pages, reason: consistency.reason || null, outliers: consistency.outliers.map((o) => ({ path: o.path, score: o.score, differences: o.differences.map((d) => d.text) })) });
  const counted = judged.filter(countsAsDefect);
  const status = counted.length ? 'defects' : 'pass';
  const distinct = uniqueCounted(judged).length;
  bus.emit('run.result', { status, findings: distinct });
  if (headed && pace) await sleep(1800); // hold the final banner on screen for whoever is watching
  const summary = meter.finish();
  const { video } = await session.close();
  writeReport(runDir, { stamp: stamp(P.root, contract), url, kind: 'flow', ...(contract ? { contract: contractSummary(contract), viewport: { ...viewport, mobile: contract.platform === 'mobile' } } : {}), byRule, outcome: { status, counted: counted.length }, violations: judged, steps, coverage, ...(forms !== 'off' ? { forms: formRows, testDataTag: tag } : {}), ...(consistency ? { consistency } : {}) });
  const exitCode = counted.length ? EXIT.DEFECTS : EXIT.PASS;
  bus.emit('run.end', { status, exitCode, totalMs: summary.totalMs, totalUsd: summary.totalUsd, findings: distinct, findingsRaw: counted.length, byRule, coverage, video });
  return { status, exitCode, runDir, runId, url, ...(contract ? { contract: contractSummary(contract), consistency } : {}), findings: judged, counted, byRule, coverage, steps, summary, video };
}
