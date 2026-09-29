// What Jev is used for here: fast typed micro-decisions with a calibrated confidence. It is never the final judge:
// below the confidence gate the decision escalates (see cascade.mjs). Three roles:
//   classifyRisk : "would clicking this control delete data, move money or change access?"  (safety screen for the flow explorer)
//   triageFinding: "is this rule finding a real defect a reviewer would care about?"          (first-pass triage)
//   pickNext     : "which untested control should be exercised next?"                         (flow explorer)
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { systemOne } from './typesafe.mjs';
import { pickWithClaude } from './judge.mjs';

export const CONFIDENCE_GATE = Number(process.env.CONFIDENCE_GATE || 0.8);

const yes = (a) => a.noul >= 0.5;

export async function classifyRisk({ label, context = '' }, opts = {}) {
  const r = await systemOne({
    ...opts,
    state: { control_label: label, context, note: 'Label may be in English or Mongolian.' },
    questions: {
      risky: {
        type: 'noul',
        instructions: 'Would clicking this button in a banking or lending web app delete data, move or spend money, change someone\'s access or credentials, or end the current login session (log out)?',
        criteria: { true: 'Yes: irreversible deletion, payment, transfer, disbursement, logout or session end, access change', false: 'No: navigation, search, filter, view, export, cancel, close a dialog or other harmless action' }
      }
    }
  });
  const a = r.answers.risky;
  return { risky: yes(a), p: a.noul, confidence: a.confidence, derivedConfidence: !!a.confidenceDerived, usage: r.usage, ms: r.ms, cached: !!r.cached };
}

export function triageState(f) {
  return {
    task: 'A deterministic UI checker reported a design-system rule violation. Decide if it is a real defect.',
    rule: f.rule, measured: f.detail, element: f.element, visible_text: f.text || '',
    context: f.ctx || {}, mode: f.mode
  };
}

export async function triageFinding(f, opts = {}) {
  const r = await systemOne({
    ...opts,
    state: triageState(f),
    questions: {
      real_defect: {
        type: 'noul',
        instructions: 'Is this a genuine defect that a designer or QA reviewer would want fixed?',
        criteria: { true: 'Yes: real violation affecting users or design consistency', false: 'No: exempt or intentional, e.g. logo wordmark, decorative or hidden text, inactive control, non-design-system widget' }
      }
    }
  });
  const a = r.answers.real_defect;
  return { real: yes(a), p: a.noul, confidence: a.confidence, derivedConfidence: !!a.confidenceDerived, usage: r.usage, ms: r.ms, cached: !!r.cached };
}

export async function pickNext({ goal, candidates }, opts = {}) {
  const open = candidates.map((c, i) => ({ c, i })).filter((x) => !x.c.visited);
  if (!open.length) return { choice: -1, confidence: 0, source: 'jev' };
  const criteria = Object.fromEntries(open.slice(0, 255).map(({ c, i }) => [`c${i}`, `${c.role} "${c.label}"`]));
  const r = await systemOne({
    ...opts,
    state: { goal, page_controls: open.map(({ c, i }) => `c${i}: ${c.role} "${c.label}"`) },
    questions: { next: { type: 'choice', instructions: 'Which single control should be tested next to cover the page\'s distinct functions?', criteria } }
  });
  const a = r.answers.next;
  return { choice: Number(a.choice.slice(1)), confidence: a.confidence, source: 'jev', usage: r.usage, ms: r.ms };
}

// ---- deterministic pickers and the gated picker used by the flow explorer ----
const RISKY = /(delete|remove|устгах|pay|төлбөр|submit|илгээх|logout|sign out|гарах|confirm|reset|drop)/i;
export function heuristicPicker({ candidates }) {
  let best = -1, bestScore = -1;
  candidates.forEach((c, i) => {
    if (c.visited) return;
    let s = 1;
    if (c.role === 'tab') s += 3;
    if (c.role === 'link') s += 1;
    if (c.role === 'button') s += 2;
    if (RISKY.test(c.label)) s -= 5;
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return { choice: best, confidence: best < 0 ? 0 : bestScore >= 3 ? 0.9 : 0.6, source: 'heuristic' };
}

// Chain: Jev -> if unsure, the free heuristic (a pick carries no safety weight, the risk screen is the safety gate;
// PICK_ESCALATE=claude / escalateUnsure:'claude' asks Claude instead) -> if Jev FAILS, Claude -> if that fails too, the heuristic.
// A pick is always produced while untested controls remain, so a model outage never ends a run early. Every fallback is logged.
export function makePicker({ kind = process.env.PICKER || 'heuristic', meter, runDir, jevOpts = {}, claude = {}, escalateUnsure = process.env.PICK_ESCALATE || 'heuristic' } = {}) {
  const logPath = runDir ? path.join(runDir, 'escalations.jsonl') : null;
  const log = (rec) => logPath && fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n');
  const viaClaude = async (input, from, why) => {
    try {
      const second = await pickWithClaude(input, { meter, ...claude });
      log({ event: 'escalation', from, why, to: 'claude', choice: second.choice });
      return second;
    } catch (e) {
      log({ event: 'escalation_failed', from, to: 'claude', reason: e.message });
      return heuristicPicker(input);
    }
  };
  return async function pick(input) {
    if (kind === 'heuristic') return heuristicPicker(input);
    let first;
    const h = meter?.start('jev-pick');
    try {
      meter?.assertBudget();
      first = await pickNext(input, jevOpts);
      meter?.end(h, first.usage);
    } catch (e) {
      meter?.end(h, { model: 'heuristic' });
      log({ event: 'jev_failed', reason: e.message, to: 'claude' });
      return viaClaude(input, 'jev', 'jev_failed');
    }
    if (first.confidence >= CONFIDENCE_GATE && first.choice >= 0) return first;
    if (escalateUnsure === 'claude') return viaClaude(input, 'jev', 'jev_unsure');
    log({ event: 'jev_unsure', confidence: first.confidence, to: 'heuristic' });
    return heuristicPicker(input);
  };
}
