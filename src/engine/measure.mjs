// measure: check the page that is loaded right now against the design contract, in each colour mode, screen by screen.
// Shared by dig (the page it was given) and tunnel (every page the explorer reaches). Emits mode / screen / finding
// events and returns the findings; loading the page, judging and reporting stay with the caller.
import path from 'node:path';
import { neededPageHeight } from './browser.mjs';
import { collect, runRules } from './design-checks.mjs';
import { fingerprint } from './fingerprint.mjs';
import { dedupeForJudging } from '../core/findings.mjs';
import { judge } from '../models/judge.mjs';
import { makeCascade } from '../models/cascade.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SCREENS = 40; // 40 screens of 800px = a 32000px page; longer pages are measured down to there
const MAX_TOUR = 12;    // screens shown at human pace while watching

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

// An `ignore:` entry that is not a CSS selector is a contract error, found on the first page it is tried on.
export function badIgnoreSelector(page, contract) {
  return page.evaluate((sels) => sels.find((s) => { try { document.querySelector(s); return false; } catch { return true; } }) ?? null, contract.ignore);
}

// Make a freshly loaded page measurable: let it settle, freeze transitions so colours are read at their final value
// (not mid-fade after the dark-mode toggle), and give an app shell that scrolls inside an inner panel a viewport as
// tall as its content (the only case where the viewport is stretched). Returns whether it was stretched.
export async function preparePage(page, { viewport, bus }) {
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important;scroll-behavior:auto !important}' });
  if (!(await innerScrollShell(page))) return false;
  const fullHeight = await neededPageHeight(page);
  await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(fullHeight, viewport.height), 8000) });
  bus.emit('note', { message: 'app shell with an inner scroll panel: measured with a tall viewport instead of screen by screen' });
  return true;
}

// Measure every mode. `extra` is added to every event (tunnel: the page), `decorate` shapes each finding before it is
// emitted (tunnel: a page-scoped key), `shot` names the screenshot per mode, `stage` names the meter stage.
// `within` limits the measurement to one region (a dialog, a tab panel), as a CSS selector.
export async function measureModes({ page, session, contract, modes, bus, meter, locator = null, runDir, headed = false, pace = 0, extra = {}, decorate = (f) => f, shot = (mode) => `${mode}.png`, stage = (s) => s, within = null }) {
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
      const els = await session.quiet(() => collect(page, { ignore: contract.ignore, within }));
      for (const e of els) { const p = byIdx.get(e.idx); if (!p || (!p.centerInView && e.centerInView)) byIdx.set(e.idx, e); }
      screens.push(y);
      bus.emit('screen.measured', { mode, index: i, y, elements: els.length, checked: screenRects(els, [], y, H), ...extra });
      if (headed && pace) await sleep(Math.round(pace / 2));
      const next = await page.evaluate((d) => { window.scrollBy(0, d); return window.scrollY; }, H);
      if (next <= y) break;
      await page.waitForTimeout(120); // let lazy-loaded content settle
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    return { els: [...byIdx.values()].sort((a, b) => a.idx - b.idx), screens, H };
  };

  const all = [], skipped = [];
  let total = 0, current = null, h, fp = null;
  for (const mode of modes) {
    bus.emit('mode.start', { mode, ...extra });
    h = meter.start(stage(`checks-${mode}`));
    // A page without a dark mode looks exactly the same after switching: checking it again would only double every
    // finding. Compared right before and right after the switch, in the same scroll state, so nothing else differs.
    const before = mode === 'dark' && current === 'light' ? await page.evaluate(paintSignature) : null;
    await session.quiet(() => applyMode(mode));
    current = mode;
    if (before != null && (await page.evaluate(paintSignature)) === before) {
      meter.end(h);
      const why = 'no dark mode on this page (switching the OS setting and the dark class changed nothing)';
      skipped.push(mode);
      if (extra.page == null) bus.emit('note', { message: `dark skipped: ${why}` }); // tunnel says it per page, in page.measured
      bus.emit('mode.done', { mode, skipped: why, elements: 0, findings: 0, checked: [], ...extra });
      continue;
    }
    const { els, screens, H } = await measureScreens(mode);
    total = Math.max(total, els.length);
    if (mode === 'light' || !fp) fp = fingerprint(els); // how the page composes its tokens (tunnel compares pages)
    const found = runRules(els, contract, { mode }).map(decorate);
    all.push(...found);
    meter.end(h);
    if (locator) {
      h = meter.start(stage(`locate-${mode}`));
      for (const f of found) { if (f.rule !== 'font-size-sprawl') f.where = locator.locate(f.hint); delete f.hint; }
      meter.end(h);
      for (const message of locator.notes.splice(0)) bus.emit('note', { message });
    } else for (const f of found) delete f.hint;
    for (const f of found) bus.emit('finding', { key: f.key, rule: f.rule, severity: f.severity, tier: f.tier, ref: f.ref, fix: f.fix, element: f.element, text: f.text, detail: f.detail, mode: f.mode, rect: f.rect, where: f.where || null, ...extra });
    // Watching: a slow tour of the real results, screen by screen (headless runs never wait or scroll for show).
    if (headed && pace) {
      for (const [i, y] of screens.slice(0, MAX_TOUR).entries()) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await sleep(150);
        bus.emit('screen.show', { mode, index: i, of: Math.min(screens.length, MAX_TOUR), y, checked: screenRects(els, found, y, H), ...extra });
        await sleep(pace + 400);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    bus.emit('mode.done', { mode, elements: els.length, findings: found.length, screens: screens.length, checked: checkedRects(els, found), ...extra });
    h = meter.start(stage(`screenshot-${mode}`));
    await session.quiet(() => page.screenshot({ path: path.join(runDir, shot(mode)), fullPage: true }));
    meter.end(h);
  }
  return { findings: all, elements: total, skipped, fingerprint: fp };
}

// Judge design findings. Each distinct defect goes to the models once and its verdict is copied to its twins: the same
// element in light and dark, and (tunnel) the same shell element with the same measurement on every page it appears on.
export async function judgeDesign(findings, { triage, meter, runDir, bus, context }) {
  if (triage === 'none' || !findings.length) return findings;
  const { unique, spread } = dedupeForJudging(findings);
  const judgedUnique = triage === 'cascade'
    ? await makeCascade({ meter, runDir, bus }).triage(unique) // Jev first, Claude for the uncertain ones
    : await judge(unique, { meter, context });
  const judged = spread(judgedUnique);
  for (const f of judged) bus.emit('verdict', { key: f.key, verdict: f.verdict, by: f.by, confidence: f.confidence ?? null });
  return judged;
}
