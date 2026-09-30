// Turn a run result into what a coding agent needs: a short verdict, the distinct defects with who decided each,
// and where the evidence lives. Compact on purpose: it goes straight into the model's context.
import path from 'node:path';
import { groupFindings, stripMode } from '../core/findings.mjs';

const sevRank = { high: 0, medium: 1, low: 2 };
const usd = (u) => (u == null ? 'n/a' : u === 0 ? '$0' : u < 0.01 ? `$${u.toFixed(4)}` : `$${u.toFixed(3)}`);
const secs = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);

export function nuggets(findings, limit = 25) {
  return groupFindings(findings)
    .filter((g) => g.verdict !== 'false_positive')
    .sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3))
    .slice(0, limit)
    .map((g) => ({
      severity: g.severity, rule: g.rule, element: g.element, detail: stripMode(g.detail), modes: g.modes,
      verdict: g.verdict || 'rule-only', decidedBy: g.verdict ? g.by : 'rule', confidence: g.confidence ?? null,
    }));
}

export function summarize(kind, r) {
  const status = r.status;
  const list = r.findings ? nuggets(r.findings) : [];
  const distinct = groupFindings(r.findings || []).filter((g) => g.verdict !== 'false_positive').length;
  const dismissed = groupFindings(r.findings || []).filter((g) => g.verdict === 'false_positive').length;
  return {
    tool: `mole ${kind}`, url: r.url, status, exitCode: r.exitCode,
    verdict: status === 'not_run' ? 'NOT RUN: nothing was tested (this is a failure, not a pass)' : status === 'defects' ? `NUGGETS FOUND: ${distinct} distinct defect${distinct === 1 ? '' : 's'}` : 'SURFACED: no defects found in what was tested',
    problem: r.problem || null, distinctDefects: distinct, dismissedAsNotDefects: dismissed,
    elementsChecked: r.elements ?? null, coverage: r.coverage || null,
    timeMs: r.summary?.totalMs ?? null, costUsd: r.summary?.totalUsd ?? null,
    nuggets: list, runFolder: r.runDir, screenshots: r.runDir ? ['light.png', 'dark.png'].map((f) => path.join(r.runDir, f)) : [],
  };
}

export function toText(s) {
  const out = [`**${s.verdict}**  (exit ${s.exitCode})`, `${s.tool} ${s.url}`];
  if (s.problem) out.push(`Reason: ${s.problem}`);
  const meta = [s.elementsChecked != null ? `${s.elementsChecked} elements` : null, s.coverage ? `${s.coverage.exercised}/${s.coverage.controlsFound} controls clicked (stopped: ${s.coverage.stopReason})` : null, s.timeMs != null ? secs(s.timeMs) : null, s.costUsd != null ? usd(s.costUsd) : null].filter(Boolean);
  if (meta.length) out.push(meta.join(' · '));
  if (s.dismissedAsNotDefects) out.push(`${s.dismissedAsNotDefects} finding(s) judged not-a-defect by the models and left out.`);
  if (s.nuggets.length) {
    out.push('', 'Defects (highest severity first):');
    s.nuggets.forEach((n, i) => out.push(`${i + 1}. [${n.severity}] ${n.rule} · \`${n.element}\` — ${n.detail}${n.modes.length ? ` (${n.modes.join('+')})` : ''} — ${n.verdict === 'real' ? `confirmed by ${n.decidedBy}${n.confidence != null ? ` ${Math.round(n.confidence * 100)}%` : ''}` : n.verdict === 'unjudged' ? 'needs a person (models unavailable)' : n.verdict === 'uncertain' ? 'uncertain' : 'found by rule'}`));
  }
  if (s.runFolder) out.push('', `Evidence: ${s.runFolder}`);
  return out.join('\n');
}
