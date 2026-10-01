// dig: scan one URL against the design-system rules in light and dark mode ("digging up bugs").
// Deterministic rules find the facts; an optional cascade (Jev, then Claude for the unsure) judges them.
// Pure engine: emits events on the bus, writes the run directory, returns a result. It never prints or exits.
import path from 'node:path';
import { P } from '../core/paths.mjs';
import { createRun, writeReport } from '../core/run.mjs';
import { EventBus } from '../core/events.mjs';
import { uniqueCounted } from '../core/findings.mjs';
import { EXIT, NotRunError } from '../core/errors.mjs';
import { stamp } from '../core/stamp.mjs';
import { toSsoRegex } from './browser.mjs';
import { openSession } from './session.mjs';
import { badIgnoreSelector, preparePage, measureModes, judgeDesign } from './measure.mjs';
import { resolveContract, contractSummary, VIEWPORTS, ContractError } from './contract.mjs';
import { createLocator, projectRoot } from './locate.mjs';
import { loadChecked } from './guard.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Findings a person still has to look at: everything except what the models dismissed as not a defect.
export const countsAsDefect = (f) => f.verdict !== 'false_positive';

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
  const badIgnore = await badIgnoreSelector(page, contract);
  if (badIgnore) { await session.close(); throw new ContractError(`ignore entry "${badIgnore}" is not a valid CSS selector`); }
  await preparePage(page, { viewport, bus });
  const loadMs = meter.end(h).ms;
  bus.emit('page.loaded', { url, elements: loaded.elements, ms: loadMs });

  const { findings: all, elements: total } = await measureModes({ page, session, contract, modes, bus, meter, locator, runDir, headed, pace });

  const judged = await judgeDesign(all, { triage, meter, runDir, bus, context: `Design-system scan of ${url} against the design contract "${contract.name}" (${contract.platform}). Contrast findings on text over images/gradients are skipped by the engine; the rest were measured from painted pixels.` });

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
