// A run = one directory under runs/ + a Meter + an event bus with its trace file. Everything a command produces
// (events.jsonl, decisions.jsonl, trace.jsonl, report.json, screenshots) lands in the run directory.
import fs from 'node:fs';
import path from 'node:path';
import { P } from './paths.mjs';
import { Meter } from './meter.mjs';
import { EventBus, traceTo } from './events.mjs';

export const loadPricing = () => JSON.parse(fs.readFileSync(path.join(P.config, 'pricing.json'), 'utf8'));

export function createRun({ name, plannedSteps = null, bus = new EventBus(), maxUsd } = {}) {
  const runId = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(P.runs, runId);
  const meter = new Meter({ runDir, pricing: loadPricing(), plannedSteps, bus, ...(maxUsd != null ? { maxUsd } : {}) });
  traceTo(bus, path.join(runDir, 'trace.jsonl'));
  return { runId, runDir, meter, bus };
}

export const writeReport = (runDir, report) => fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
