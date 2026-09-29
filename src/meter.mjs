// Time + cost meter. Every stage of a run is logged as JSONL so a dashboard can tail the file live.
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { BudgetExceeded } from './resilience.mjs';

export class Meter {
  constructor({ runDir, pricing, plannedSteps = null, maxUsd = Number(process.env.BUDGET_USD || 1) }) {
    this.maxUsd = maxUsd;
    this.runDir = runDir;
    this.pricing = pricing;
    this.plannedSteps = plannedSteps;
    this.startedAt = Date.now();
    this.stages = [];
    fs.mkdirSync(runDir, { recursive: true });
    this.eventsPath = path.join(runDir, 'events.jsonl');
    fs.writeFileSync(this.eventsPath, '');
    this._emit({ type: 'run_start', plannedSteps });
  }

  _emit(evt) {
    fs.appendFileSync(this.eventsPath, JSON.stringify({ t: Date.now() - this.startedAt, ...evt }) + '\n');
  }

  costOf(model, inputTokens = 0, outputTokens = 0) {
    const p = this.pricing.models?.[model];
    if (!p || p.inputPerM == null || p.outputPerM == null) return null; // unpriced
    return (inputTokens * p.inputPerM + outputTokens * p.outputPerM) / 1e6;
  }

  spentUsd() { return this.stages.reduce((s, x) => s + (x.costUsd ?? 0), 0); }

  // Called before every model call: a runaway loop stops at the cap instead of at the invoice.
  assertBudget() {
    if (this.spentUsd() >= this.maxUsd) throw new BudgetExceeded(this.spentUsd(), this.maxUsd);
  }

  start(stage, meta = {}) {
    this._emit({ type: 'stage_start', stage, ...meta });
    return { stage, t0: performance.now(), meta };
  }

  end(handle, usage = {}) {
    const ms = Math.round(performance.now() - handle.t0);
    const model = usage.model ?? 'playwright';
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const costUsd = this.costOf(model, inputTokens, outputTokens);
    const rec = { stage: handle.stage, ms, model, inputTokens, outputTokens, costUsd, ...handle.meta };
    this.stages.push(rec);
    this._emit({ type: 'stage_end', ...rec });
    return rec;
  }

  // Live projection: assumes remaining steps cost about the same as the average completed step.
  estimate() {
    const done = this.stages.length;
    const elapsedMs = Date.now() - this.startedAt;
    const spentKnown = this.stages.reduce((s, x) => s + (x.costUsd ?? 0), 0);
    const unpriced = this.stages.filter((x) => x.costUsd == null).length;
    if (!this.plannedSteps || done === 0) return { done, elapsedMs, spentUsd: spentKnown, unpriced, projected: null };
    const remaining = Math.max(this.plannedSteps - done, 0);
    return {
      done,
      elapsedMs,
      spentUsd: spentKnown,
      unpriced,
      projected: {
        totalMs: Math.round(elapsedMs + (elapsedMs / done) * remaining),
        totalUsd: spentKnown + (spentKnown / done) * remaining
      }
    };
  }

  finish() {
    const est = this.estimate();
    const summary = {
      totalMs: est.elapsedMs,
      totalUsd: est.spentUsd,
      unpricedCalls: est.unpriced,
      stages: this.stages
    };
    this._emit({ type: 'run_end', totalMs: summary.totalMs, totalUsd: summary.totalUsd });
    fs.writeFileSync(path.join(this.runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    return summary;
  }
}
