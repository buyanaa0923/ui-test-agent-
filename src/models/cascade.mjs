// The trust ladder for judgement calls: deterministic facts -> Jev (fast, calibrated) -> Claude (ambiguous only) -> human.
// Asymmetric on purpose: dismissing a finding as "not a defect" needs more confidence than confirming one, because
// wrongly dismissing a real defect is the costly mistake. Every decision is written to decisions.jsonl.
import '../core/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { triageFinding, classifyRisk } from './jev.mjs';
import { judge, claudeRisk } from './judge.mjs';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function makeCascade({ meter, runDir, bus = null, gateConfirm = num(process.env.GATE_CONFIRM, 0.8), gateDismiss = num(process.env.GATE_DISMISS, 0.9), jevOpts = {}, claude = {} } = {}) {
  const logPath = runDir ? path.join(runDir, 'decisions.jsonl') : null;
  const log = (rec) => {
    if (logPath) fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');
    bus?.emit(rec.kind === 'risk' ? 'control.risk' : 'decision', rec);
  };
  const cost = (u) => (u && meter ? meter.costOf(u.model, u.inputTokens, u.outputTokens) : null);

  async function pool(items, n, fn) {
    const out = new Array(items.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); } }));
    return out;
  }

  // Findings in, findings out with verdict / by / p / confidence added.
  async function triage(findings) {
    if (!findings.length) return [];
    const h = meter?.start('jev-triage', { findings: findings.length });
    const agg = { model: 'jev-1.13', inputTokens: 0, outputTokens: 0 };
    let jevDown = null;
    const first = await pool(findings, 4, async (f) => {
      if (jevDown) return { f, err: jevDown };
      try {
        meter?.assertBudget();
        const r = await triageFinding(f, jevOpts);
        agg.inputTokens += r.usage.inputTokens; agg.outputTokens += r.usage.outputTokens;
        return { f, r };
      } catch (e) {
        if (/circuit open|budget|TYPESAFE_API_KEY|401/.test(e.message)) jevDown = e.message; // stop hammering a dead or unauthorised service
        return { f, err: e.message };
      }
    });
    meter?.end(h, agg);

    const settled = new Map(), toClaude = [];
    for (const { f, r, err } of first) {
      if (err) { log({ kind: 'triage', key: f.key, by: 'jev', event: 'jev_failed', reason: err }); toClaude.push(f); continue; }
      const conf = r.confidence, gate = r.real ? gateConfirm : gateDismiss;
      if (conf >= gate) {
        settled.set(f.key, { ...f, verdict: r.real ? 'real' : 'false_positive', by: 'jev', p: r.p, confidence: conf, reason: `Jev p(real)=${r.p.toFixed(2)}, confidence ${conf.toFixed(2)}` });
        log({ kind: 'triage', key: f.key, by: 'jev', decision: r.real ? 'real' : 'false_positive', p: r.p, confidence: conf, gate, escalated: false, ms: r.ms, costUsd: cost(r.usage), inputTokens: r.usage?.inputTokens, cached: r.cached });
      } else {
        log({ kind: 'triage', key: f.key, by: 'jev', decision: 'uncertain', p: r.p, confidence: conf, gate, escalated: true, ms: r.ms, costUsd: cost(r.usage), inputTokens: r.usage?.inputTokens, cached: r.cached });
        toClaude.push({ ...f, _jev: { p: r.p, confidence: conf } });
      }
    }

    let judged = [];
    if (toClaude.length) {
      judged = await judge(toClaude.map(({ _jev, ...f }) => f), { meter, ...claude });
      judged.forEach((f, i) => { const j = toClaude[i]._jev; log({ kind: 'triage', key: f.key, by: f.verdict === 'unjudged' ? 'none' : 'claude', decision: f.verdict, escalated: true, jevP: j?.p, jevConfidence: j?.confidence }); });
    }
    const byKey = new Map([...settled, ...judged.map((f) => [f.key, { ...f, by: f.verdict === 'unjudged' ? 'none' : 'claude' }])]);
    return findings.map((f) => byKey.get(f.key) || { ...f, verdict: 'unjudged', by: 'none' });
  }

  // Safe to click? Fails safe: anything not clearly harmless is skipped.
  async function screenRisk(cand) {
    const c = { label: cand.label, context: `${cand.role}${cand.context ? ', ' + cand.context : ''}` };
    let j = null;
    const h = meter?.start('jev-risk', { label: cand.label });
    try { meter?.assertBudget(); j = await classifyRisk(c, jevOpts); meter?.end(h, j.usage); } catch (e) { meter?.end(h, { model: 'heuristic' }); log({ kind: 'risk', label: cand.label, by: 'jev', event: 'jev_failed', reason: e.message }); }
    if (j) {
      const gate = j.risky ? gateConfirm : gateDismiss; // calling a control "safe" needs the higher bar
      if (j.confidence >= gate) { log({ kind: 'risk', label: cand.label, by: 'jev', decision: j.risky ? 'risky' : 'safe', p: j.p, confidence: j.confidence, escalated: false, ms: j.ms, costUsd: cost(j.usage) }); return { risky: j.risky, by: 'jev' }; }
    }
    try {
      const cl = await claudeRisk(c, { meter, ...claude });
      const safe = !cl.risky && cl.confidence >= gateDismiss;
      log({ kind: 'risk', label: cand.label, by: 'claude', decision: cl.risky ? 'risky' : safe ? 'safe' : 'uncertain', confidence: cl.confidence, escalated: true, jevP: j?.p, jevConfidence: j?.confidence });
      return { risky: !safe, by: 'claude' };
    } catch (e) {
      log({ kind: 'risk', label: cand.label, by: 'none', decision: 'skipped_fail_safe', reason: e.message });
      return { risky: true, by: 'fail-safe' };
    }
  }

  return { triage, screenRisk, gates: { gateConfirm, gateDismiss } };
}
