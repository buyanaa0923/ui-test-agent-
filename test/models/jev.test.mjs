// Jev client tested against a local mock that follows the documented TypeSafe response shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { systemOne, validateAnswers } from '../../src/models/typesafe.mjs';
import { classifyRisk, triageFinding, pickNext } from '../../src/models/jev.mjs';

function mock(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
        const body = JSON.parse(b); calls.push({ headers: req.headers, body });
        const [status, json] = handler(body, calls.length);
        res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(json));
      });
    }).listen(0, () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, calls, close: () => { srv.closeAllConnections(); srv.close(); } }));
  });
}
const ok = (answers) => [200, { model: 'jev-1.13.0', answers, usage: { input_tokens: 120, output_tokens: 9 } }];

test('sends the documented request shape and bearer auth', async () => {
  const m = await mock(() => ok({ risky: { type: 'noul', noul: 0.97, confidence: 0.9 } }));
  const r = await classifyRisk({ label: 'Delete account' }, { base: m.base, key: 'k-test' });
  assert.equal(m.calls[0].headers.authorization, 'Bearer k-test');
  assert.equal(m.calls[0].body.model, 'jev-latest');
  assert.equal(m.calls[0].body.questions.risky.type, 'noul');
  assert.deepEqual(Object.keys(m.calls[0].body).sort(), ['model', 'questions', 'state']);
  assert.equal(r.risky, true); assert.equal(r.usage.inputTokens, 120);
  m.close();
});

test('triage returns probability, confidence and token usage', async () => {
  const m = await mock(() => ok({ real_defect: { type: 'noul', noul: 0.12, confidence: 0.85 } }));
  const r = await triageFinding({ rule: 'font-family', detail: 'font is "Georgia"', element: 'span.logo', text: 'NetCapital', ctx: { ariaHidden: false }, mode: 'light' }, { base: m.base, key: 'k' });
  assert.equal(r.real, false); assert.equal(r.confidence, 0.85);
  assert.match(JSON.stringify(m.calls[0].body.state), /font-family/);
  m.close();
});

test('pickNext offers only untested controls and maps the choice back to an index', async () => {
  const m = await mock((body) => ok({ next: { type: 'choice', choice: 'c2', confidence: 0.9, probabilities: { c2: 1 } } }));
  const r = await pickNext({ goal: 'g', candidates: [{ role: 'button', label: 'A', visited: true }, { role: 'button', label: 'B', visited: false }, { role: 'tab', label: 'C', visited: false }] }, { base: m.base, key: 'k' });
  assert.deepEqual(Object.keys(m.calls[0].body.questions.next.criteria), ['c1', 'c2']);
  assert.equal(r.choice, 2);
  m.close();
});

test('retries on 429 then succeeds', async () => {
  const m = await mock((_, n) => (n < 3 ? [429, { error: 'rate limit' }] : ok({ risky: { type: 'noul', noul: 0.1, confidence: 0.9 } })));
  const r = await classifyRisk({ label: 'Search' }, { base: m.base, key: 'k' });
  assert.equal(r.risky, false); assert.equal(m.calls.length, 3);
  m.close();
});

test('does not retry a 401 and reports it', async () => {
  const m = await mock(() => [401, { error: 'bad key' }]);
  await assert.rejects(classifyRisk({ label: 'x' }, { base: m.base, key: 'bad' }), /401/);
  assert.equal(m.calls.length, 1);
  m.close();
});

test('malformed replies are rejected, not trusted', () => {
  const q = { risky: { type: 'noul' } };
  assert.throws(() => validateAnswers({ answers: {} }, q), /missing answer/);
  assert.throws(() => validateAnswers({ answers: { risky: { noul: 1.4, confidence: 0.5 } } }, q), /noul probability/);
  assert.throws(() => validateAnswers({ answers: { risky: {} } }, q), /noul probability/);
  assert.throws(() => validateAnswers({ answers: { next: { choice: 'a' } } }, { next: { type: 'choice', criteria: { a: 'x' } } }), /confidence/);
  assert.throws(() => validateAnswers({ answers: { next: { choice: 'zz', confidence: 0.5 } } }, { next: { type: 'choice', criteria: { a: 'x' } } }), /not offered/);
});

test('missing key fails clearly before any network call', async () => {
  await assert.rejects(systemOne({ state: 's', questions: {}, key: '' }), /TYPESAFE_API_KEY/);
});

test('yes/no answer without confidence: confidence is derived from the probability and flagged', () => {
  const body = { answers: { risky: { type: 'noul', noul: 0.93 } } };
  validateAnswers(body, { risky: { type: 'noul' } });
  assert.equal(body.answers.risky.confidence, 0.93);
  assert.equal(body.answers.risky.confidenceDerived, true);
  const low = { answers: { risky: { type: 'noul', noul: 0.4 } } };
  validateAnswers(low, { risky: { type: 'noul' } });
  assert.equal(low.answers.risky.confidence, 0.6);
});

test('a real confidence from the API is kept, not overwritten', () => {
  const body = { answers: { risky: { type: 'noul', noul: 0.95, confidence: 0.81 } } };
  validateAnswers(body, { risky: { type: 'noul' } });
  assert.equal(body.answers.risky.confidence, 0.81);
  assert.equal(body.answers.risky.confidenceDerived, undefined);
});
