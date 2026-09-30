// The one seam between the engine (what happens) and every surface that shows it (terminal, browser overlay,
// dashboard, MCP). The engine emits plain-JSON events and knows nothing about who listens. A run's whole
// event stream is also written to trace.jsonl, so any run can be replayed later without re-running it.
//
// Event vocabulary (every event has `type` and `t`, ms since the bus was created):
//   run.start     { command, url, runId, runDir, modes?, max?, cascade, picker? }
//   page.loaded   { url, elements, ms }
//   mode.start    { mode }                                    light / dark
//   mode.done     { mode, elements, findings, checked }       checked = [{ rect, rule|null }] every element measured
//   finding       { key, rule, severity, element, detail, mode, rect }        found by a deterministic rule
//   decision      { key, by, decision, p, confidence, escalated, ms, costUsd, inputTokens, outputTokens }   Jev / Claude verdict
//   control.found { count }                                   flow: interactive controls on the page
//   control.pick  { n, role, label, by, confidence }          flow: control chosen next
//   control.risk  { n, label, by, risky, confidence }         flow: safety screen result
//   control.click { n, role, label, rect }                    flow: clicking now
//   control.result{ n, label, changed, dialogOpened, errors, failedRequests, skipped }
//   stage.start / stage.end  { stage, ms?, model?, costUsd? } timing + cost per stage (from the Meter)
//   run.end       { status, exitCode, totalMs, totalUsd, findings, byRule, coverage? }
//   not_run       { problem }                                 nothing was tested; never a pass
import fs from 'node:fs';

export class EventBus {
  constructor() {
    this.startedAt = Date.now();
    this.listeners = new Set();
    this.history = [];
  }

  // replay: a late subscriber (e.g. the browser overlay, attached once the browser is up) first receives everything emitted so far.
  on(fn, { replay = false } = {}) {
    if (replay) for (const evt of this.history) { try { fn(evt); } catch { /* a broken display must never break a run */ } }
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload = {}) {
    const evt = { type, t: Date.now() - this.startedAt, ...payload };
    this.history.push(evt);
    for (const fn of this.listeners) {
      try { fn(evt); } catch (e) { /* a broken display must never break a test run */ }
    }
    return evt;
  }
}

// Append every event to a JSONL file. Sync appends keep the file ordered and readable while the run is live.
export function traceTo(bus, file) {
  fs.writeFileSync(file, '');
  return bus.on((evt) => fs.appendFileSync(file, JSON.stringify(evt) + '\n'));
}

export function readTrace(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// A bus that goes nowhere: lets engine code call bus.emit unconditionally.
export const nullBus = { on: () => () => {}, emit: () => null, history: [] };
