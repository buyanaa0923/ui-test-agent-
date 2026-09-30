// dig: scan one URL against the design-system rules in light and dark mode ("digging up bugs").
// Deterministic rules find the facts; an optional cascade (Jev, then Claude for the unsure) judges them.
// Pure engine: emits events on the bus, writes the run directory, returns a result. It never prints or exits.
import path from 'node:path';
import { P } from '../core/paths.mjs';
import { createRun, writeReport } from '../core/run.mjs';
import { EventBus } from '../core/events.mjs';
import { dedupeForJudging, uniqueCounted } from '../core/findings.mjs';
import { EXIT, NotRunError } from '../core/errors.mjs';
import { stamp } from '../core/stamp.mjs';
import { toSsoRegex, neededPageHeight } from './browser.mjs';
import { openSession } from './session.mjs';
import { collect, runRules } from './design-checks.mjs';
import { resolveContract, contractSummary, VIEWPORTS, ContractError } from './contract.mjs';
import { createLocator, projectRoot } from './locate.mjs';
import { loadChecked } from './guard.mjs';
import { judge } from '../models/judge.mjs';
import { makeCascade } from '../models/cascade.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SCREENS = 40; // 40 screens of 800px = a 32000px page; longer pages are measured down to there
const MAX_TOUR = 12;    // screens shown at human pace while watching

// Findings a person still has to look at: everything except what the models dismissed as not a defect.
export const countsAsDefect = (f) => f.verdict !== 'false_positive';

// Runs in the page: its painted colours, to tell whether switching to dark mode changed anything at all.
function paintSignature() {
  const out = [];
  for (const el of [document.body, ...document.querySelectorAll('body *')].slice(0, 600)) {
    const cs = getComputedStyle(el);
    out.push(cs.color, cs.backgroundColor, cs.borderTopColor, cs.backgroundImage.slice(0, 40));
  }
  return out.join('|');
}

// Runs in the page: an app shell (the window does not scroll, an inner panel does) cannot be read screen by screen.
function innerScrollShell(page) {
  return page.evaluate(() => {
    if (document.documentElement.scrollHeight > innerHeight + 2) return false;
    for (const el of document.querySelectorAll('body *')) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 50 && el.clientHeight > innerHeight * 0.4) return true;
    }
    return false;
  });
}

// The measured elements on one screen, in window coordinates, with the rule that flagged each (for the overlay).
function screenRects(els, findings, y, H) {
  return checkedRects(els.filter((e) => e.rect.y + e.rect.h > y && e.rect.y < y + H), findings).map((r) => ({ ...r, y: r.y - y }));
}

// Every text/control element that was measured, with whether a rule flagged it (drives the overlay sweep).
function checkedRects(els, findings) {
  const bad = new Map(findings.map((f) => [`${f.rect?.x},${f.rect?.y},${f.rect?.w},${f.rect?.h}`, f.rule]));
  return els
    .filter((e) => e.hasText || e.isControl || e.isButton)
    .slice(0, 500)
    .map((e) => ({ ...e.rect, rule: bad.get(`${e.rect.x},${e.rect.y},${e.rect.w},${e.rect.h}`) || null }));
}

export async function dig(opts, ctx = {}) {
  const {
    url, modes = ['light', 'dark'], name = 'scan',
    design = null, platform = null, // design.md path (else found in cwd, else the built-in default) and desktop | mobile
    triage = 'none', // 'none' | 'cascade' (Jev then Claude) | 'claude' (Claude only)
    storageState = null, ssoButton = null, headed = false, record = false, pace = 900,
    root = null, locate = true, // project source to map findings to file:line (default: the design's project, else cwd)
  } = opts;
  // Resolve the contract before anything starts: a broken design.md is a usage error, not a page defect.
  const contract = opts.contract || resolveContract({ design, platform });
  const viewport = opts.viewport || VIEWPORTS[contract.platform];
  const designFile = contract.sources.find((s) => s.kind === 'design')?.path;
  const locator = locate ? createLocator({ url, root: root || process.env.MOLE_SRC_ROOT || (designFile ? projectRoot(path.dirname(designFile)) : process.env.MOLE_PROJECT_DIR || process.cwd()) }) : null;
  const bus = ctx.bus || new EventBus();
  const run = createRun({ name, bus, plannedSteps: 2 + modes.length * (locator ? 3 : 2) + (triage !== 'none' ? 1 : 0), maxUsd: opts.maxUsd });
  const { runDir, meter, runId } = run;
  bus.emit('run.start', { command: 'dig', url, modes, runId, runDir, triage, contract: contractSummary(contract) });
  for (const message of contract.notes) bus.emit('note', { message });

  const finishNotRun = async (problem, session) => {
    await session?.page?.screenshot({ path: path.join(runDir, 'not-run.png') }).catch(() => {});
    await session?.close();
    const s = meter.finish();
    writeReport(runDir, { url, kind: 'design', status: 'not_run', problem, contract: contractSummary(contract), byRule: {}, violations: [] });
    bus.emit('not_run', { problem });
    bus.emit('run.end', { status: 'not_run', exitCode: EXIT.NOT_RUN, totalMs: s.totalMs, totalUsd: s.totalUsd, findings: 0, byRule: {} });
    return { status: 'not_run', exitCode: EXIT.NOT_RUN, problem, runDir, runId, findings: [], byRule: {} };
  };

  let session;
  try {
    session = await openSession({ viewport, mobile: contract.platform === 'mobile', headed, storageState, record, runDir, attach: ctx.attach, bus, meter });
  } catch (e) {
    if (e instanceof NotRunError) return finishNotRun(e.problem, null);
    throw e;
  }
  const { page } = session;

  let h = meter.start('load', { url });
  const loaded = await loadChecked(page, url, { ssoButton: toSsoRegex(ssoButton) });
  if (!loaded.ok) { meter.end(h); return finishNotRun(loaded.problem, session); }
  const badIgnore = await page.evaluate((sels) => sels.filter((s) => { try { document.querySelector(s); return false; } catch { return true; } }), contract.ignore);
  if (badIgnore.length) { await session.close(); throw new ContractError(`ignore entry "${badIgnore[0]}" is not a valid CSS selector`); }
  await page.waitForTimeout(500);
  // Freeze transitions so colors are read at their final value, not mid-fade after the dark-mode toggle.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important;scroll-behavior:auto !important}' });
  // An app shell that scrolls inside an inner panel cannot be read by scrolling the window: measure it with a viewport
  // as tall as its content instead (the only case where the viewport is stretched).
  if (await innerScrollShell(page)) {
    const fullHeight = await neededPageHeight(page);
    await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(fullHeight, viewport.height), 8000) });
    bus.emit('note', { message: 'app shell with an inner scroll panel: measured with a tall viewport instead of screen by screen' });
  }
  const loadMs = meter.end(h).ms;
  bus.emit('page.loaded', { url, elements: loaded.elements, ms: loadMs });

  // Dark mode the two usual ways: the OS setting (prefers-color-scheme) and a `dark` class on <html>.
  const applyMode = async (mode) => {
    await page.emulateMedia({ colorScheme: mode === 'dark' ? 'dark' : 'light' });
    await page.evaluate((m) => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
    await page.waitForTimeout(300);
  };

  // One screen at a time at the real window size: a stretched viewport breaks 100vh layouts and, in a visible window,
  // looks like a sudden zoom. The same element seen on two screens is kept from the screen where it was in view.
  const measureScreens = async (mode) => {
    const H = await page.evaluate(() => innerHeight);
    await page.evaluate(() => window.scrollTo(0, 0));
    const byIdx = new Map(), screens = [];
    for (let i = 0; i < MAX_SCREENS; i++) {
      const y = await page.evaluate(() => window.scrollY);
      const els = await session.quiet(() => collect(page, { ignore: contract.ignore }));
      for (const e of els) { const p = byIdx.get(e.idx); if (!p || (!p.centerInView && e.centerInView)) byIdx.set(e.idx, e); }
      screens.push(y);
      bus.emit('screen.measured', { mode, index: i, y, elements: els.length, checked: screenRects(els, [], y, H) });
      if (headed && pace) await sleep(Math.round(pace / 2));
      const next = await page.evaluate((d) => { window.scrollBy(0, d); return window.scrollY; }, H);
      if (next <= y) break;
      await page.waitForTimeout(120); // let lazy-loaded content settle
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return { els: [...byIdx.values()].sort((a, b) => a.idx - b.idx), screens, H };
  };

  const all = [];
  let total = 0, current = null;
  for (const mode of modes) {
    bus.emit('mode.start', { mode });
    h = meter.start(`checks-${mode}`);
    // A page without a dark mode looks exactly the same after switching: checking it again would only double every
    // finding. Compared right before and right after the switch, in the same scroll state, so nothing else differs.
    const before = mode === 'dark' && current === 'light' ? await page.evaluate(paintSignature) : null;
    await session.quiet(() => applyMode(mode));
    current = mode;
    if (before != null && (await page.evaluate(paintSignature)) === before) {
      meter.end(h);
      const why = 'no dark mode on this page (switching the OS setting and the dark class changed nothing)';
      bus.emit('note', { message: `dark skipped: ${why}` });
      bus.emit('mode.done', { mode, skipped: why, elements: 0, findings: 0, checked: [] });
      continue;
    }
    const { els, screens, H } = await measureScreens(mode);
    total = Math.max(total, els.length);
    const found = runRules(els, contract, { mode });
    all.push(...found);
    meter.end(h);
    if (locator) {
      h = meter.start(`locate-${mode}`);
      for (const f of found) { if (f.rule !== 'font-size-sprawl') f.where = locator.locate(f.hint); delete f.hint; }
      meter.end(h);
      for (const message of locator.notes.splice(0)) bus.emit('note', { message });
    } else for (const f of found) delete f.hint;
    for (const f of found) bus.emit('finding', { key: f.key, rule: f.rule, severity: f.severity, tier: f.tier, ref: f.ref, fix: f.fix, element: f.element, text: f.text, detail: f.detail, mode: f.mode, rect: f.rect, where: f.where || null });
    // Watching: a slow tour of the real results, screen by screen (headless runs never wait or scroll for show).
    if (headed && pace) {
      for (const [i, y] of screens.slice(0, MAX_TOUR).entries()) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await sleep(150);
        bus.emit('screen.show', { mode, index: i, of: Math.min(screens.length, MAX_TOUR), y, checked: screenRects(els, found, y, H) });
        await sleep(pace + 400);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    bus.emit('mode.done', { mode, elements: els.length, findings: found.length, screens: screens.length, checked: checkedRects(els, found) });
    h = meter.start(`screenshot-${mode}`);
    await session.quiet(() => page.screenshot({ path: path.join(runDir, `${mode}.png`), fullPage: true }));
    meter.end(h);
  }

  let judged = all;
  if (triage !== 'none') {
    // The same defect in light and dark is judged once and the verdict is copied to its twin: half the model calls.
    const { unique, spread } = dedupeForJudging(all);
    const judgedUnique = triage === 'cascade'
      ? await makeCascade({ meter, runDir, bus }).triage(unique) // Jev first, Claude for the uncertain ones
      : await judge(unique, { meter, context: `Design-system scan of ${url} against the design contract "${contract.name}" (${contract.platform}). Contrast findings on text over images/gradients are skipped by the engine; the rest were measured from painted pixels.` });
    judged = spread(judgedUnique);
    for (const f of judged) bus.emit('verdict', { key: f.key, verdict: f.verdict, by: f.by, confidence: f.confidence ?? null });
  }

  const byRule = {};
  for (const v of judged) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
  const counted = judged.filter(countsAsDefect);
  const status = counted.length ? 'defects' : 'pass';
  const distinct = uniqueCounted(judged).length; // one bug seen in light and dark is one defect
  bus.emit('run.result', { status, findings: distinct });
  if (headed && pace) await sleep(1800); // hold the final banner on screen for whoever is watching
  const summary = meter.finish();
  const { video } = await session.close();
  writeReport(runDir, { stamp: stamp(P.root, contract), url, contract: contractSummary(contract), viewport: { ...viewport, mobile: contract.platform === 'mobile' }, byRule, kind: 'design', outcome: { status, counted: counted.length, distinct, dismissed: judged.length - counted.length, elements: total }, violations: judged });
  const exitCode = counted.length ? EXIT.DEFECTS : EXIT.PASS;
  bus.emit('run.end', { status, exitCode, totalMs: summary.totalMs, totalUsd: summary.totalUsd, findings: distinct, findingsRaw: counted.length, dismissed: judged.length - counted.length, elements: total, byRule, video });
  return { status, exitCode, runDir, runId, url, contract: contractSummary(contract), elements: total, findings: judged, counted, byRule, summary, video };
}
