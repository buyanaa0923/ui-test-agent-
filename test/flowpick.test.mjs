import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWithClaude } from '../src/judge.mjs';
import { shouldReportDeadClick } from '../src/flow-rules.mjs';

const cands = [
  { role: 'link', label: 'Home', visited: true },
  { role: 'button', label: 'Filters', visited: false },
  { role: 'link', label: 'Reports', visited: false },
];
const usage = { model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 5 };

test('Claude picker is only shown controls that are still untested, with their original indexes', async () => {
  let seen = '';
  const p = await pickWithClaude({ goal: 'g', candidates: cands }, { send: async (prompt) => { seen = prompt; return { text: '{"choice":2,"confidence":0.9}', usage }; } });
  assert.doesNotMatch(seen, /Home/);
  assert.match(seen, /1: button "Filters"/);
  assert.equal(p.choice, 2);
});

test('a pick of an already-tested control is rejected, so the caller falls back instead of ending the run', async () => {
  await assert.rejects(pickWithClaude({ goal: 'g', candidates: cands }, { send: async () => ({ text: '{"choice":0,"confidence":0.9}', usage }) }), /already tested/);
});

test('a click that changed nothing is a dead click', () => {
  assert.equal(shouldReportDeadClick({ clickError: null, changed: false, errors: [], active: false, selfLink: false }), true);
});
test('a link to the page you are already on is not a dead click', () => {
  assert.equal(shouldReportDeadClick({ clickError: null, changed: false, errors: [], active: false, selfLink: true }), false);
});
test('a current-page indicator (aria-current) is not a dead click', () => {
  assert.equal(shouldReportDeadClick({ clickError: null, changed: false, errors: [], active: true, selfLink: false }), false);
});
test('a click that changed something, threw or could not be made is not reported as dead', () => {
  assert.equal(shouldReportDeadClick({ clickError: null, changed: true, errors: [], active: false, selfLink: false }), false);
  assert.equal(shouldReportDeadClick({ clickError: null, changed: false, errors: ['x'], active: false, selfLink: false }), false);
  assert.equal(shouldReportDeadClick({ clickError: 'timeout', changed: false, errors: [], active: false, selfLink: false }), false);
});

// ---- picker chain: Jev -> (unsure) free heuristic | (failed) Claude -> heuristic ----
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePicker } from '../src/jev.mjs';
import { resetBreaker } from '../src/typesafe.mjs';

const jevServer = (respond) => new Promise((resolve) => {
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const body = JSON.parse(b); const [st, js] = respond(body); res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(js)); }); })
    .listen(0, () => resolve({ opts: { base: `http://127.0.0.1:${srv.address().port}`, key: 'k' }, close: () => { srv.closeAllConnections(); srv.close(); } }));
});
const choiceAnswer = (confidence) => (body) => [200, { model: 'jev-1.13.0', answers: { next: { type: 'choice', choice: Object.keys(body.questions.next.criteria)[0], confidence } }, usage: { input_tokens: 100, output_tokens: 5 } }];
const open = [{ role: 'link', label: 'A', visited: false }, { role: 'button', label: 'B', visited: false }];
const chain = async (jevRespond, claudeSend, extra = {}) => {
  resetBreaker();
  const jev = await jevServer(jevRespond);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-'));
  let claudeCalls = 0;
  const pick = makePicker({ kind: 'jev', runDir, jevOpts: jev.opts, claude: { send: async (p) => { claudeCalls++; return claudeSend(p); } }, ...extra });
  return { pick, jev, runDir, claudeCalls: () => claudeCalls, log: () => (fs.existsSync(path.join(runDir, 'escalations.jsonl')) ? fs.readFileSync(path.join(runDir, 'escalations.jsonl'), 'utf8') : '') };
};
const claudeOk = async () => ({ text: '{"choice":1,"confidence":0.9}', usage });

test('picker: confident Jev pick is used, no other model is called', async () => {
  const t = await chain(choiceAnswer(0.95), claudeOk);
  try { const p = await t.pick({ goal: 'g', candidates: open }); assert.equal(p.source, 'jev'); assert.equal(t.claudeCalls(), 0); } finally { t.jev.close(); }
});
test('picker: unsure Jev falls back to the free heuristic (not Claude) and logs it', async () => {
  const t = await chain(choiceAnswer(0.5), claudeOk);
  try { const p = await t.pick({ goal: 'g', candidates: open }); assert.equal(p.source, 'heuristic'); assert.equal(t.claudeCalls(), 0); assert.match(t.log(), /jev_unsure/); } finally { t.jev.close(); }
});
test('picker: PICK_ESCALATE=claude keeps the old behaviour (unsure Jev asks Claude)', async () => {
  const t = await chain(choiceAnswer(0.5), claudeOk, { escalateUnsure: 'claude' });
  try { const p = await t.pick({ goal: 'g', candidates: open }); assert.equal(p.source, 'claude'); assert.equal(t.claudeCalls(), 1); } finally { t.jev.close(); }
});
test('picker: when Jev is down, Claude is the fallback', async () => {
  const t = await chain(() => [401, {}], claudeOk);
  try { const p = await t.pick({ goal: 'g', candidates: open }); assert.equal(p.source, 'claude'); assert.match(t.log(), /jev_failed/); } finally { t.jev.close(); }
});
test('picker: when Jev and Claude are both down, the heuristic still picks (run never ends early)', async () => {
  const t = await chain(() => [401, {}], async () => { throw new Error('down'); });
  try { const p = await t.pick({ goal: 'g', candidates: open }); assert.equal(p.source, 'heuristic'); assert.ok(p.choice >= 0); } finally { t.jev.close(); }
});

import { collect } from '../src/scorecard-data.mjs';
test('scorecard counts picker fallbacks (Jev unsure -> heuristic, Jev failed) as fallbacks taken', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const dir = path.join(root, 'runs', 'flow-x');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ kind: 'flow', url: 'http://localhost:5200/', violations: [], steps: [] }));
  fs.writeFileSync(path.join(dir, 'escalations.jsonl'), ['{"event":"jev_unsure"}', '{"event":"jev_failed"}', '{"event":"escalation"}', '{"event":"escalation_failed"}'].join('\n'));
  const data = collect(root);
  const json = JSON.stringify(data);
  assert.match(json, /"fallbacks":3/); // unsure + failed + escalation_failed
});

import { dropToolCausedErrors } from '../src/flow-rules.mjs';
const ERR = 'console: Failed to load resource: net::ERR_FAILED';
test('resource failures caused by the tool blocking a cross-origin request are not app errors', () => {
  assert.deepEqual(dropToolCausedErrors([ERR], 1), { errors: [], toolBlocked: 1 });
});
test('the same console error with nothing blocked is a real app error', () => {
  assert.deepEqual(dropToolCausedErrors([ERR], 0), { errors: [ERR], toolBlocked: 0 });
});
test('only as many resource errors as requests we blocked are dropped; other errors always stay', () => {
  const other = 'pageerror: x is not a function';
  assert.deepEqual(dropToolCausedErrors([ERR, other, ERR], 1), { errors: [other, ERR], toolBlocked: 1 });
});

import { isAllowedRequest, errorFindingRule } from '../src/flow-rules.mjs';
test('requests to the app origin, data: URLs and explicitly allowed origins are let through; everything else is blocked', () => {
  const allowed = new Set(['http://localhost:5200', 'http://localhost:5300']);
  assert.equal(isAllowedRequest('http://localhost:5200/a.js', allowed), true);
  assert.equal(isAllowedRequest('http://localhost:5300/remoteEntry.js', allowed), true);
  assert.equal(isAllowedRequest('data:image/png;base64,xx', allowed), true);
  assert.equal(isAllowedRequest('http://localhost:5012/remoteEntry.js', allowed), false);
  assert.equal(isAllowedRequest('https://example.com/x', allowed), false);
});
test('a console error that coincides with a request the tool blocked is downgraded, an ordinary one stays high', () => {
  assert.deepEqual(errorFindingRule(0), { rule: 'js-error', severity: 'high' });
  assert.deepEqual(errorFindingRule(2), { rule: 'js-error-blocked-context', severity: 'low' });
});

test('scorecard data: real-app evaluation is "not yet measured" until labels and an eval exist, then carries n, kappa and the preliminary flag', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc2-'));
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true }); fs.mkdirSync(path.join(root, 'config'), { recursive: true }); fs.mkdirSync(path.join(root, 'eval'), { recursive: true });
  fs.writeFileSync(path.join(root, 'eval/real-findings.meta.json'), JSON.stringify({ records: 18 }));
  const none = collect(root).quality.real;
  assert.equal(none.set.records, 18); assert.equal(none.labels, null); assert.equal(none.eval, null);
  fs.writeFileSync(path.join(root, 'runs/real-labels.json'), JSON.stringify({ records: 18, bothLabelled: 18, kappa: { n: 16, kappa: 0.71, observed: 0.88, interpretation: 'substantial' }, finalLabels: 15 }));
  fs.writeFileSync(path.join(root, 'runs/eval-real.json'), JSON.stringify({ mode: 'live', stamp: { at: 'x' }, costUsd: 0.01, score: { n: 18, nModelEligible: 15, clusters: 8, target: { status: 'preliminary', goal: 0.9 }, cascade: { accuracyOnDecided: { p: 0.9, k: 9, n: 10, lo: 0.6, hi: 0.98 }, escalatedToHuman: 2, escalatedToClaude: 5 } } }));
  const r = collect(root).quality.real;
  assert.equal(r.labels.kappa.kappa, 0.71);
  assert.equal(r.eval.target.status, 'preliminary');
  assert.equal(r.eval.cascade.accuracyOnDecided.n, 10);
});
