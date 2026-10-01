import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { tunnel } = await import('../../src/engine/tunnel.mjs');
const { UsageError } = await import('../../src/core/errors.mjs');
const { isSandboxHost, sensitiveReason, testValue, submitOutcome } = await import('../../src/engine/forms.mjs');

// ---- pure rules ----

test('isSandboxHost: dev hosts yes, anything else only when named', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]', 'app.localhost', 'shop.test', '0.0.0.0']) assert.ok(isSandboxHost(h), h);
  for (const h of ['example.com', 'staging.bank.mn', '10.0.0.5', 'localhost.evil.com']) assert.ok(!isSandboxHost(h), h);
  assert.ok(isSandboxHost('uat.bank.mn', ['uat.bank.mn']));
});

test('testValue: obvious test data from the field type and name, in English and Mongolian, within the field\'s limits', () => {
  const v = (f) => testValue({ type: 'text', ...f }, { tag: 'abc123', today: '2026-10-01' });
  assert.equal(v({ type: 'email' }).value, 'mole.test+abc123@example.test');
  assert.equal(v({ label: 'Имэйл хаяг' }).value, 'mole.test+abc123@example.test');
  assert.equal(v({ type: 'tel', pattern: '\\+976[0-9]{8}' }).value, '+97699119911', 'the first candidate that fits the pattern');
  assert.equal(v({ label: 'Утасны дугаар' }).value, '99119911');
  assert.equal(v({ label: 'Регистрийн дугаар' }).value, 'УБ99119911');
  assert.equal(v({ type: 'number', min: '5', max: '10' }).value, '5');
  assert.equal(v({ type: 'date' }).value, '2026-10-01');
  assert.equal(v({ label: 'Full name', maxLength: 6 }).value, 'Mole T');
  assert.equal(v({ label: 'Code', pattern: '[A-Z]{3}' }).mismatch, true, 'no candidate fits: filled anyway, and marked');
  assert.deepEqual(v({ type: 'select', options: [{ value: '', label: 'Choose' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }] }), { select: 'c' });
  assert.deepEqual(v({ type: 'checkbox', required: true }), { check: true });
  assert.ok(v({ type: 'checkbox' }).skip, 'optional boxes are left alone');
  assert.ok(v({ value: 'Ann' }).skip, 'a filled field (an edit form) keeps its value');
  assert.ok(v({ type: 'password' }).skip);
});

test('sensitiveReason: credential, payment and one-time-code forms are never filled', () => {
  assert.match(sensitiveReason([{ type: 'text', label: 'User' }, { type: 'password', label: 'Password' }]), /password/);
  assert.ok(sensitiveReason([{ type: 'text', label: 'Card number' }]));
  assert.ok(sensitiveReason([{ type: 'text', label: 'Нууц үг' }]));
  assert.ok(sensitiveReason([{ type: 'text', autocomplete: 'one-time-code' }]));
  assert.ok(sensitiveReason([{ type: 'text', label: 'Дансны дугаар' }]));
  assert.equal(sensitiveReason([{ type: 'email', label: 'Email' }, { type: 'text', label: 'Pinned note' }]), null);
});

test('submitOutcome: server error, silent refusal, visible refusal, dead submit, success', () => {
  const w = (status) => [{ method: 'POST', path: '/api/x', status }];
  assert.equal(submitOutcome({ writes: w(500), changed: true }).rule, 'submit-server-error');
  assert.equal(submitOutcome({ writes: w(422), changed: false }).rule, 'submit-silent-failure');
  assert.equal(submitOutcome({ writes: w(422), changed: true }).outcome, 'rejected');
  assert.equal(submitOutcome({ writes: [], changed: false }).rule, 'dead-submit');
  assert.equal(submitOutcome({ writes: w(201), changed: true }).outcome, 'ok');
  assert.equal(submitOutcome({ writes: [], landed: '/done' }).outcome, 'ok');
});

// ---- an app full of forms, in a real browser ----

const form = (name, body, handler) => `<form aria-label="${name}" onsubmit="event.preventDefault(); ${handler}">${body}</form>`;
const PAGE = `<!doctype html><html lang="en"><head><title>Forms</title></head><body><main><h1>Forms</h1><p id="s" role="status"></p><div id="err" role="alert"></div>
${form('Contact', '<label for="n">Name</label><input id="n" name="name" required> <label for="e">Email</label><input id="e" name="email" type="email" required> <label for="p">Phone</label><input id="p" name="phone" type="tel" pattern="[0-9]{8}"> <label for="t">Topic</label><select id="t" name="topic" required><option value="">Choose</option><option>Sales</option></select> <label for="m">Message</label><textarea id="m" name="message"></textarea> <input id="a" name="agree" type="checkbox" required><label for="a">I agree</label> <button>Send</button>', "post('/api/contact', this, () => s('Thanks'))")}
${form('Broken', '<label for="b1">Title</label><input id="b1" name="title"> <button>Save broken</button>', "post('/api/broken', this, () => {})")}
${form('Quiet', '<label for="q1">Title</label><input id="q1" name="title"> <button>Save quiet</button>', "post('/api/quiet', this, () => {})")}
${form('Loud', '<label for="l1">Title</label><input id="l1" name="title"> <button>Save loud</button>', "post('/api/loud', this, (r) => { if (!r.ok) document.getElementById('err').textContent = 'That title is taken'; })")}
${form('Dead', '<label for="d1">Nickname</label><input id="d1" name="nick"> <button>Go dead</button>', '')}
<form aria-label="Stuck"><label for="k1">Code name</label><input id="k1" name="code" required> <button disabled>Send it</button></form>
${form('Card', '<label for="c1">Card number</label><input id="c1" name="card"> <button>Save card</button>', "post('/api/card', this, () => {})")}
${form('Transfer', '<label for="t1">Amount</label><input id="t1" name="amount" type="number" min="1"> <button>Pay now</button>', "post('/api/pay', this, () => {})")}
<button onclick="document.getElementById('dlg').hidden = false">New customer</button>
</main>
<div id="dlg" role="dialog" aria-modal="true" aria-label="New customer" hidden style="position:fixed;top:40px;left:40px;background:#fff;border:1px solid #333;padding:16px"><h2>New customer</h2><label for="cn">Customer name</label><input id="cn" required> <button onclick="createCustomer()">Create</button> <button onclick="document.getElementById('dlg').hidden = true">Cancel</button></div>
<script>
function s(t) { document.getElementById('s').textContent = t; }
function post(url, f, then) { fetch(url, { method: 'POST', body: new URLSearchParams(new FormData(f)) }).then(then); }
function createCustomer() { fetch('/api/customers', { method: 'POST', body: document.getElementById('cn').value }).then(() => { document.getElementById('dlg').hidden = true; s('Customer created'); }); }
</script></body></html>`;
const STATUS = { '/api/contact': 201, '/api/broken': 500, '/api/quiet': 422, '/api/loud': 422, '/api/customers': 201, '/api/card': 201, '/api/pay': 201 };

async function app(fn) {
  const posts = [];
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { posts.push({ url: req.url, body: b }); res.writeHead(STATUS[req.url] || 404); res.end(); }); return; }
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.writeHead(req.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); res.end(req.url === '/' ? PAGE : '<h1>Nope</h1>');
  }).listen(0);
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, posts); } finally { srv.closeAllConnections(); srv.close(); }
}
const has = (r, rule, element) => r.findings.some((f) => f.rule === rule && f.element === element);
const rowOf = (r, name) => r.coverage && JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8')).forms.find((f) => f.form === name);

test('forms off (the default): no field is typed into and nothing is sent', async () => app(async (origin, posts) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-forms-off', max: 40, stateDepth: 1 });
  assert.equal(posts.length, 0); assert.equal(r.coverage.formsFound, 0);
}));

test('forms fill: every form is filled with test data and checked, nothing is sent', async () => app(async (origin, posts) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-forms-fill', max: 40, stateDepth: 1, forms: 'fill' });
  assert.equal(posts.length, 0, 'fill never submits');
  assert.ok(has(r, 'submit-stays-disabled', 'form "Stuck"'), 'valid data, and the button is still disabled');
  const contact = rowOf(r, 'Contact');
  assert.equal(contact.valid, true, 'the browser accepts the generated data');
  assert.match(contact.fields.find((x) => x.field === 'Email').value, /^mole\.test\+[0-9a-f]{6}@example\.test$/);
  assert.equal(contact.fields.find((x) => x.field === 'Topic').value, 'Sales');
  assert.equal(rowOf(r, 'Card').outcome, 'skipped', 'a card form is never filled');
  assert.ok(rowOf(r, 'New customer'), 'the dialog\'s fields are a form too');
  assert.ok(!fs.existsSync(path.join(r.runDir, 'submissions.jsonl')));
  assert.ok(!r.findings.some((f) => ['dead-submit', 'submit-server-error'].includes(f.rule)));
}));

test('forms submit: judges what each submit came back with, writes a ledger, never sends card or payment forms', async () => app(async (origin, posts) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-forms-submit', max: 40, stateDepth: 1, forms: 'submit', maxSubmits: 10 });
  const sent = posts.map((p) => p.url);
  assert.ok(has(r, 'submit-server-error', 'form "Broken"'), '500 on valid data');
  assert.ok(has(r, 'submit-silent-failure', 'form "Quiet"'), '422 and the page said nothing');
  assert.ok(!r.findings.some((f) => f.element === 'form "Loud"'), 'a refusal the page shows is not a defect');
  assert.equal(rowOf(r, 'Loud').outcome, 'rejected');
  assert.ok(has(r, 'dead-submit', 'form "Dead"'), 'submitting did nothing at all');
  assert.equal(rowOf(r, 'Contact').outcome, 'submitted');
  const body = new URLSearchParams(posts.find((p) => p.url === '/api/contact').body);
  assert.match(body.get('email'), /@example\.test$/); assert.match(body.get('name'), /^Mole Test [0-9a-f]{6}$/); assert.equal(body.get('agree'), 'on');
  assert.ok(sent.includes('/api/customers'), 'the dialog form was submitted through its Create button');
  assert.equal(rowOf(r, 'New customer').outcome, 'submitted');
  assert.ok(!sent.includes('/api/card'), 'never a card form'); assert.ok(!sent.includes('/api/pay'), 'never a "Pay now" submit');
  assert.match(rowOf(r, 'Transfer').notSubmitted, /risky label/);
  const ledger = fs.readFileSync(path.join(r.runDir, 'submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(ledger.length, r.coverage.formsSubmitted, 'every submission is in the ledger');
  assert.ok(ledger.every((l) => l.tag && l.form && Array.isArray(l.fields)));
  assert.ok(!r.findings.some((f) => f.rule === 'js-error'), 'the browser\'s "Failed to load resource" line is the failed submit, not a second defect');
  assert.ok(!r.findings.some((f) => f.rule === 'dead-click'), 'ticking a native checkbox is a change (its label names it: "I agree")');
  assert.equal(sent.filter((u) => u === '/api/customers').length, 1, 'the dialog\'s Create was clicked once, by the form test, not by the click-through');
}));

test('forms submit: capped per run, and the cap is reported', async () => app(async (origin, posts) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-forms-cap', max: 40, forms: 'submit', maxSubmits: 2 });
  assert.equal(r.coverage.formsSubmitted, 2); assert.ok(posts.length <= 2);
  assert.ok(r.coverage.submitsBeyondCap >= 1);
  const held = JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8')).forms.filter((f) => /submit cap/.test(f.notSubmitted || ''));
  assert.equal(r.coverage.submitsBeyondCap, held.length, 'only forms the cap alone held back are counted as over it');
}));

test('forms submit refuses a host that is not a dev host, before anything starts', async () => {
  await assert.rejects(tunnel({ url: 'https://bank.example.com/', name: 't-forms-host', forms: 'submit' }), (e) => e instanceof UsageError && /--submit-host bank\.example\.com/.test(e.message));
});
