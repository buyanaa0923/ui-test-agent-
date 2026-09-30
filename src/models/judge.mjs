// Verdict step: an LLM reads the deterministic findings and decides real / false positive / needs a human,
// with a one-line fix. The model never invents findings; it only rules on ones the rule engine already produced.
// Two routes: JUDGE_MODE=api (Anthropic Messages API, needs ANTHROPIC_API_KEY) or JUDGE_MODE=cli (the developer's own
// Claude Code login through `claude -p`: no key to hand out).
import '../core/env.mjs';
import { spawn } from 'node:child_process';
import { withRetry, CircuitBreaker } from '../core/resilience.mjs';
import { parseJson, validateVerdicts, validatePick } from './schema.mjs';

const breaker = new CircuitBreaker();

const MODEL = process.env.JUDGE_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You are a strict QA reviewer for web UIs built on the netOS design system (Tailwind, Inter/Montserrat/JetBrains Mono, WCAG AA).
You receive findings produced by a deterministic rule engine. For each finding decide:
- "real": a genuine defect a user or reviewer would care about
- "false_positive": the rule misfired (e.g. decorative text, disabled control, text over an image the engine could not measure)
- "needs_human": you cannot tell from the facts given
Never add findings that are not in the input. Reply with ONLY a JSON array, one object per input finding, same order:
[{"key":"<finding key>","verdict":"real|false_positive|needs_human","severity":"high|medium|low","reason":"<max 20 words>","fix":"<one concrete change, max 20 words>"}]`;

async function viaApi(prompt, system = SYSTEM) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Claude is not configured: ANTHROPIC_API_KEY is not set (or use your Claude Code login: JUDGE_MODE=cli)');
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages: [{ role: 'user', content: prompt }] })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${body?.error?.message || JSON.stringify(body).slice(0, 200)}`);
  const text = body.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage: { model: MODEL.replace(/-\d{8}$/, ''), inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 } };
}

// The developer's own Claude Code login, no API key: `claude -p`. Async, so the live panel keeps moving while Claude
// thinks. The instructions travel on stdin with the question (no quoting problems on Windows, where an npm install is
// claude.cmd and needs a shell), and --strict-mcp-config keeps the nested session from starting MCP servers (Mole included).
export function viaCli(prompt, system = SYSTEM, { timeoutMs = 180000, bin = process.env.MOLE_CLAUDE_BIN || 'claude' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-p', '--output-format', 'json', '--strict-mcp-config'], { shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, MOLE_WATCH: '' } });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`claude -p gave no answer within ${timeoutMs / 1000}s`)); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude -p could not start: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude -p failed (exit ${code}): ${err.slice(0, 200)}`));
      try { const o = JSON.parse(out); resolve({ text: o.result ?? '', usage: { model: 'claude-cli', inputTokens: 0, outputTokens: 0 } }); } catch { reject(new Error(`claude -p did not answer in JSON: ${out.slice(0, 120)}`)); }
    });
    p.stdin.end(`${system}\n\n---\n\n${prompt}`);
  });
}

// Every Claude call goes through here: JUDGE_MODE=cli uses the Claude Code login, anything else the API key.
const route = async (prompt, system = SYSTEM, mode = process.env.JUDGE_MODE || 'api') => {
  if (mode === 'off') throw new Error('Claude is not configured: judging is switched off (the finding goes to a person)');
  return mode === 'cli' ? viaCli(prompt, system) : viaApi(prompt, system);
};

// findings: [{key, rule, severity, element, text, detail, mode}]; returns findings with .verdict/.reason/.fix added.
export async function judge(findings, { meter, context = '', mode = process.env.JUDGE_MODE || 'api', send } = {}) {
  if (!findings.length) return [];
  const slim = findings.map((f) => ({ key: f.key, rule: f.rule, element: f.element, text: f.text, detail: f.detail, mode: f.mode }));
  const prompt = `${context ? context + '\n\n' : ''}Findings:\n${JSON.stringify(slim, null, 1)}`;
  const h = meter?.start('verdict', { findings: findings.length });
  const known = new Set(findings.map((f) => f.key));
  let res, parsed, problem = null;
  try {
    meter?.assertBudget();
    // One repair attempt if the model answers with malformed or unknown-key JSON, then give up honestly.
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      res = await breaker.run(() => withRetry(() => (send ? send(prompt) : route(prompt, SYSTEM, mode))));
      try {
        const v = validateVerdicts(parseJson(res.text, 'array'), known);
        if (v.ok) parsed = v;
        else problem = v.errors.join('; ');
      } catch (e) { problem = e.message; }
    }
  } catch (e) {
    meter?.end(h, res?.usage || { model: 'heuristic' });
    return findings.map((f) => ({ ...f, verdict: 'unjudged', reason: e.message.slice(0, 120), fix: '' }));
  }
  meter?.end(h, res.usage);
  if (!parsed) return findings.map((f) => ({ ...f, verdict: 'unjudged', reason: `invalid model output: ${String(problem).slice(0, 100)}`, fix: '' }));
  const byKey = new Map(parsed.value.map((v) => [v.key, v]));
  return findings.map((f) => {
    const v = byKey.get(f.key);
    return v ? { ...f, verdict: v.verdict, severity: v.severity || f.severity, reason: v.reason, fix: v.fix } : { ...f, verdict: 'needs_human', reason: 'no verdict returned', fix: '' };
  });
}

// One-off pick used as the escalation target when the cheap picker is unsure.
export async function pickWithClaude({ goal, candidates }, { meter, send } = {}) {
  // Only offer controls not yet tested (original indexes kept). Offering all of them let the model pick a tested one and end the run.
  const open = candidates.map((c, i) => ({ c, i })).filter((x) => !x.c.visited);
  const prompt = `Goal: ${goal}\nCandidates (untested controls only):\n${open.map(({ c, i }) => `${i}: ${c.role} "${c.label}"`).join('\n')}\nReply ONLY JSON: {"choice":<index>,"confidence":<0-1>}`;
  meter?.assertBudget();
  const h = meter?.start('escalate-claude');
  const res = await breaker.run(() => withRetry(() => (send ? send(prompt) : route(prompt, 'You choose which UI control an automated tester should try next. Reply ONLY with the JSON asked for.'))));
  meter?.end(h, res.usage);
  const v = validatePick(parseJson(res.text, 'object'), candidates.length);
  if (!v.ok) throw new Error(v.errors[0]);
  if (v.value.choice >= 0 && candidates[v.value.choice].visited) throw new Error(`model picked control ${v.value.choice}, which was already tested`);
  return { ...v.value, source: 'claude' };
}

// Yes/no question for the risk screen when Jev is unsure. Same validation and budget rules as the other Claude calls.
export async function claudeRisk({ label, context = '' }, { meter, send } = {}) {
  const system = 'You are a safety screen for an automated UI tester in a banking/lending web app. Labels may be English or Mongolian. Reply ONLY JSON: {"risky":true|false,"confidence":<0-1>}. risky=true means clicking would delete data, move or spend money, change someone\'s access or credentials, or end the current login session (log out).';
  const prompt = `Control label: "${label}"\nContext: ${context || 'none'}`;
  meter?.assertBudget();
  const h = meter?.start('escalate-claude-risk');
  const res = await breaker.run(() => withRetry(() => (send ? send(prompt) : route(prompt, system))));
  meter?.end(h, res.usage);
  const o = parseJson(res.text, 'object');
  if (typeof o.risky !== 'boolean' || typeof o.confidence !== 'number') throw new Error('bad risk answer from Claude');
  return { risky: o.risky, confidence: Math.min(Math.max(o.confidence, 0), 1), usage: res.usage };
}

// Raw senders for the evaluation harness (so it can cache and replay Claude calls).
export const viaApiForEval = {
  judge: (prompt) => viaApi(prompt),
  risk: () => (prompt) => viaApi(prompt, 'You are a safety screen for an automated UI tester in a banking/lending web app. Labels may be English or Mongolian. Reply ONLY JSON: {"risky":true|false,"confidence":<0-1>}. risky=true means clicking would delete data, move or spend money, change someone\'s access or credentials, or end the current login session (log out).')
};
