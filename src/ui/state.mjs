// Pure reducer: (state, event) -> state. Every surface (live terminal, plain log, overlay HUD, replay from trace.jsonl)
// derives what it shows from this one state, so they can never disagree.

import { groupFindings as groupFindingsOf, uniqueCounted as uniqueCountedOf } from '../core/findings.mjs';

export const createState = ({ pricing = null } = {}) => ({
  pricing, command: null, url: null, runId: null, runDir: null, triage: 'none', picker: null, riskScreen: false, max: null, modes: [],
  phase: 'idle', // idle | loading | checking | judging | tunnelling | done | not_run
  t: 0, startedAt: 0,
  steps: [], // dig: load / light / dark / judge
  elements: 0,
  findings: [], // { key, rule, severity, element, detail, mode, verdict, by, confidence, ms, pending }
  jev: { settled: 0, unsure: 0, calls: 0, ms: [], usd: 0, inputTokens: 0 },
  claude: { consulted: 0, usd: 0 },
  human: 0,
  costUsd: 0, byModel: {},
  tunnel: { found: 0, exercised: 0, skipped: 0, dead: 0, current: null, log: [] },
  notes: [], problem: null, end: null,
});

const upsert = (arr, key, patch) => {
  const i = arr.findIndex((f) => f.key === key);
  if (i < 0) return arr;
  const next = arr.slice(); next[i] = { ...arr[i], ...patch }; return next;
};
const setStep = (steps, id, patch) => {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return [...steps, { id, label: id, status: 'wait', ...patch }];
  const next = steps.slice(); next[i] = { ...steps[i], ...patch }; return next;
};

export function reduce(s, e) {
  const st = { ...s, t: e.t ?? s.t };
  switch (e.type) {
    case 'run.start':
      return { ...st, command: e.command, url: e.url, runId: e.runId, runDir: e.runDir, triage: e.triage || 'none', picker: e.picker || null, riskScreen: !!e.riskScreen, max: e.max ?? null, modes: e.modes || [], phase: 'loading', startedAt: e.t ?? 0,
        steps: e.command === 'dig'
          ? [{ id: 'load', label: 'Dig in', status: 'run' }, ...(e.modes || []).map((m) => ({ id: m, label: m === 'dark' ? 'Dark' : m === 'light' ? 'Light' : m, status: 'wait' })), ...(e.triage && e.triage !== 'none' ? [{ id: 'judge', label: 'Sniff', status: 'wait' }] : [])]
          : [{ id: 'load', label: 'Dig in', status: 'run' }, { id: 'tunnel', label: 'Tunnel', status: 'wait' }] };
    case 'page.loaded':
      return { ...st, elements: e.elements ?? st.elements, phase: st.command === 'tunnel' ? 'tunnelling' : 'checking',
        steps: setStep(setStep(st.steps, 'load', { status: 'ok', ms: e.ms, detail: `${e.elements} elements` }), st.command === 'tunnel' ? 'tunnel' : st.modes[0], { status: 'run' }) };
    case 'mode.start':
      return { ...st, steps: setStep(st.steps, e.mode, { status: 'run' }) };
    case 'mode.done': {
      const next = st.modes[st.modes.indexOf(e.mode) + 1];
      const isLast = !next;
      return { ...st, elements: Math.max(st.elements, e.elements), steps: setStep(isLast && st.triage !== 'none' ? setStep(st.steps, 'judge', { status: 'run' }) : next ? setStep(st.steps, next, { status: 'run' }) : st.steps, e.mode, { status: 'ok', detail: `${e.elements} checked · ${e.findings} nugget${e.findings === 1 ? '' : 's'}` }),
        phase: isLast && st.triage !== 'none' ? 'judging' : st.phase };
    }
    case 'finding':
      return { ...st, findings: [...st.findings, { key: e.key, rule: e.rule, severity: e.severity, element: e.element, detail: e.detail, mode: e.mode, verdict: null, by: 'rule', confidence: null, ms: null, pending: null }] };
    case 'decision': {
      if (e.kind !== 'triage') return st;
      if (e.by === 'jev') {
        const jev = { ...st.jev, calls: st.jev.calls + 1, ms: e.ms != null ? [...st.jev.ms, e.ms] : st.jev.ms, inputTokens: st.jev.inputTokens + (e.inputTokens || 0) };
        if (e.event === 'jev_failed') return { ...st, jev, findings: upsert(st.findings, e.key, { pending: 'claude' }) };
        if (e.decision === 'uncertain') return { ...st, jev: { ...jev, unsure: jev.unsure + 1 }, findings: upsert(st.findings, e.key, { pending: 'claude', confidence: e.confidence, ms: e.ms, by: 'jev' }) };
        return { ...st, jev: { ...jev, settled: jev.settled + 1 }, findings: upsert(st.findings, e.key, { verdict: e.decision, by: 'jev', confidence: e.confidence, ms: e.ms, pending: null }) };
      }
      if (e.by === 'claude') return { ...st, claude: { ...st.claude, consulted: st.claude.consulted + 1 }, findings: upsert(st.findings, e.key, { verdict: e.decision, by: 'claude', pending: null }) };
      return { ...st, human: st.human + 1, findings: upsert(st.findings, e.key, { verdict: 'unjudged', by: 'none', pending: null }) };
    }
    case 'verdict': // final word per finding, after the cascade (also covers Claude-only triage)
      return { ...st, findings: upsert(st.findings, e.key, { verdict: e.verdict, by: e.by === 'none' ? 'none' : e.by || st.findings.find((f) => f.key === e.key)?.by, confidence: e.confidence ?? undefined, pending: null }) };
    case 'stage.end': {
      const usd = e.costUsd ?? 0, model = e.model || 'playwright';
      const byModel = { ...st.byModel, [model]: (st.byModel[model] || 0) + usd };
      return { ...st, byModel, costUsd: e.spentUsd ?? st.costUsd + usd,
        jev: model.startsWith('jev') ? { ...st.jev, usd: st.jev.usd + usd } : st.jev,
        claude: model.startsWith('claude') ? { ...st.claude, usd: st.claude.usd + usd } : st.claude };
    }
    case 'control.found':
      return { ...st, tunnel: { ...st.tunnel, found: Math.max(st.tunnel.found, e.count) } };
    case 'control.pick':
      return { ...st, tunnel: { ...st.tunnel, current: { n: e.n, role: e.role, label: e.label, by: e.by, confidence: e.confidence, phase: 'picked', risk: null } } };
    case 'control.risk': {
      const cur = st.tunnel.current;
      if (!cur || cur.label !== e.label) return st;
      return { ...st, tunnel: { ...st.tunnel, current: { ...cur, phase: 'screened', risk: { by: e.by, decision: e.decision, confidence: e.confidence } } } };
    }
    case 'control.click': {
      const cur = st.tunnel.current;
      return { ...st, tunnel: { ...st.tunnel, current: { ...(cur || {}), n: e.n, role: e.role, label: e.label, phase: 'clicking' } } };
    }
    case 'control.result': {
      const cur = st.tunnel.current || {};
      const row = { n: e.n, role: cur.role, label: e.label, by: cur.by, confidence: cur.confidence, risk: cur.risk, skipped: e.skipped || null, changed: !!e.changed, dialogOpened: !!e.dialogOpened, errors: e.errors || 0, failedRequests: e.failedRequests || 0, deadClick: !!e.deadClick };
      const log = [...st.tunnel.log, row];
      return { ...st, tunnel: { ...st.tunnel, log, current: null, exercised: st.tunnel.exercised + (e.skipped ? 0 : 1), skipped: st.tunnel.skipped + (e.skipped ? 1 : 0), dead: st.tunnel.dead + (e.deadClick ? 1 : 0) } };
    }
    case 'note':
      return { ...st, notes: [...st.notes, e.message] };
    case 'not_run':
      return { ...st, problem: e.problem, phase: 'not_run', steps: st.steps.map((x) => (x.status === 'run' ? { ...x, status: 'fail' } : x)) };
    case 'run.end':
      return { ...st, end: e, phase: e.status === 'not_run' ? 'not_run' : 'done', costUsd: e.totalUsd ?? st.costUsd,
        steps: st.steps.map((x) => (x.status === 'run' || x.status === 'wait' ? { ...x, status: e.status === 'not_run' ? 'fail' : 'ok' } : x)) };
    default:
      return st;
  }
}

// ---- derived numbers used by more than one view ----
export { findingKey, groupFindings } from '../core/findings.mjs';
export const uniqueCounted = (s) => uniqueCountedOf(s.findings);
export const counted = (s) => s.findings.filter((f) => f.verdict !== 'false_positive');
export const bySeverity = (s) => uniqueCounted(s).reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {});
export const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
// Who settled each DISTINCT defect (light + dark twins count once).
export const decidedBy = (s) => {
  const out = { rule: 0, jev: 0, claude: 0, human: 0, dismissed: 0 };
  for (const f of groupFindingsOf(s.findings)) {
    if (f.verdict === 'false_positive') out.dismissed++;
    if (f.verdict === 'unjudged') out.human++;
    else if (f.by === 'jev' && f.verdict) out.jev++;
    else if (f.by === 'claude') out.claude++;
    else if (!f.verdict) out.rule++;
  }
  return out;
};

// Honest lower bound on "what if Claude had judged everything": the input tokens Jev actually consumed, priced at
// Claude's input rate. Output tokens and Claude's own prompt overhead are ignored, so the true figure is higher.
export function claudeOnlyFloorUsd(s) {
  const p = s.pricing?.models;
  const rate = p?.['claude-sonnet-5-5']?.inputPerM;
  if (rate == null || !s.jev.inputTokens) return null;
  return (s.jev.inputTokens * rate) / 1e6;
}
