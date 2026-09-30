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
import { loadTokens, collect, runRules } from './design-checks.mjs';
import { loadChecked } from './guard.mjs';
import { judge } from '../models/judge.mjs';
import { makeCascade } from '../models/cascade.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Findings a person still has to look at: everything except what the models dismissed as not a defect.
export const countsAsDefect = (f) => f.verdict !== 'false_positive';

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
    url, modes = ['light', 'dark'], viewport = { width: 1280, height: 800 }, name = 'scan',
    triage = 'none', // 'none' | 'cascade' (Jev then Claude) | 'claude' (Claude only)
    storageState = null, ssoButton = null, headed = false, record = false, pace = 900,
  } = opts;
  const bus = ctx.bus || new EventBus();
  const run = createRun({ name, bus, plannedSteps: 2 + modes.length * 2 + (triage !== 'none' ? 1 : 0), maxUsd: opts.maxUsd });
  const { runDir, meter, runId } = run;
  bus.emit('run.start', { command: 'dig', url, modes, runId, runDir, triage });

  const finishNotRun = async (problem, session) => {
    await session?.page?.screenshot({ path: path.join(runDir, 'not-run.png') }).catch(() => {});
    await session?.close();
    const s = meter.finish();
    writeReport(runDir, { url, kind: 'design', status: 'not_run', problem, byRule: {}, violations: [] });
    bus.emit('not_run', { problem });
    bus.emit('run.end', { status: 'not_run', exitCode: EXIT.NOT_RUN, totalMs: s.totalMs, totalUsd: s.totalUsd, findings: 0, byRule: {} });
    return { status: 'not_run', exitCode: EXIT.NOT_RUN, problem, runDir, runId, findings: [], byRule: {} };
  };

  let session;
  try {
    session = await openSession({ viewport, headed, storageState, record, runDir, attach: ctx.attach, bus, meter });
  } catch (e) {
    if (e instanceof NotRunError) return finishNotRun(e.problem, null);
    throw e;
  }
  const { page } = session;
  const tokens = loadTokens(path.join(P.config, 'tokens.json'));

  let h = meter.start('load', { url });
  const loaded = await loadChecked(page, url, { ssoButton: toSsoRegex(ssoButton) });
  if (!loaded.ok) { meter.end(h); return finishNotRun(loaded.problem, session); }
  await page.waitForTimeout(500);
  // Freeze transitions so colors are read at their final value, not mid-fade after the dark-mode toggle.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important}' });
  // Make the viewport as tall as the page so every element is on screen and its background can be measured.
  const fullHeight = await neededPageHeight(page);
  await page.setViewportSize({ width: viewport.width, height: Math.min(Math.max(fullHeight, viewport.height), 8000) });
  const loadMs = meter.end(h).ms;
  bus.emit('page.loaded', { url, elements: loaded.elements, ms: loadMs });

  const all = [];
  let total = 0;
  for (const mode of modes) {
    bus.emit('mode.start', { mode });
    h = meter.start(`checks-${mode}`);
    const els = await session.quiet(async () => {
      await page.evaluate((m) => document.documentElement.classList.toggle('dark', m === 'dark'), mode);
      await page.waitForTimeout(300);
      return collect(page);
    });
    total = Math.max(total, els.length);
    const found = runRules(els, tokens, { mode });
    all.push(...found);
    meter.end(h);
    for (const f of found) bus.emit('finding', { key: f.key, rule: f.rule, severity: f.severity, element: f.element, text: f.text, detail: f.detail, mode: f.mode, rect: f.rect });
    bus.emit('mode.done', { mode, elements: els.length, findings: found.length, checked: checkedRects(els, found) });
    if (headed && pace) await sleep(pace); // let the overlay sweep play; headless runs never wait
    h = meter.start(`screenshot-${mode}`);
    await session.quiet(() => page.screenshot({ path: path.join(runDir, `${mode}.png`) }));
    meter.end(h);
  }

  let judged = all;
  if (triage !== 'none') {
    // The same defect in light and dark is judged once and the verdict is copied to its twin: half the model calls.
    const { unique, spread } = dedupeForJudging(all);
    const judgedUnique = triage === 'cascade'
      ? await makeCascade({ meter, runDir, bus }).triage(unique) // Jev first, Claude for the uncertain ones
      : await judge(unique, { meter, context: `Design-system scan of ${url} (netOS tokens). Contrast findings on text over images/gradients are skipped by the engine; the rest were measured from painted pixels.` });
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
  writeReport(runDir, { stamp: stamp(P.root), url, byRule, kind: 'design', outcome: { status, counted: counted.length, distinct, dismissed: judged.length - counted.length, elements: total }, violations: judged });
  const exitCode = counted.length ? EXIT.DEFECTS : EXIT.PASS;
  bus.emit('run.end', { status, exitCode, totalMs: summary.totalMs, totalUsd: summary.totalUsd, findings: distinct, findingsRaw: counted.length, dismissed: judged.length - counted.length, elements: total, byRule, video });
  return { status, exitCode, runDir, runId, url, elements: total, findings: judged, counted, byRule, summary, video };
}
