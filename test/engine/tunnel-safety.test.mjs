import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { tunnel } = await import('../../src/engine/tunnel.mjs');
const flowRules = await import('../../src/engine/flow-rules.mjs');
const { isRiskyLabel } = flowRules;

test('isRiskyLabel: state-changing actions and the inline "Yes, ..." that confirms them, in English and Mongolian', () => {
  for (const l of ['Лацдах', 'Тийм, лацдах', 'Тийм', 'Yes, archive', 'Confirm', 'Approve', 'Батлах', 'Баталгаажуулах', 'Цуцлах', 'Татгалзах', 'Түгжих', 'Delete', 'Устгах', 'Гарах', 'Transfer', 'Мөнгө шилжүүлэх'])
    assert.ok(isRiskyLabel(l), `${l} is risky`);
  for (const l of ['Болих', 'Cancel', 'Close', 'Нээх', 'Гүйцэтгэл', 'Устгалын хэрэг', 'Салбарын үйл ажиллагаа', 'Шилжих', 'Search', ''])
    assert.ok(!isRiskyLabel(l), `${l} is clickable`);
});

// The network-web case: "Лацдах" reveals an inline confirmation on the page itself (no role=dialog), whose
// "Тийм, лацдах" seals the record. A harmless-looking button can also reveal a bare "Тийм".
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Supplies</title></head><body><main><h1>Supplies</h1><p id="s">ready</p>
<button onclick="document.getElementById('c1').hidden=false">Лацдах</button>
<span id="c1" hidden><button onclick="document.getElementById('c1').hidden=true">Болих</button> <button onclick="fetch('/seal',{method:'POST'})">Тийм, лацдах</button></span>
<button onclick="document.getElementById('c2').hidden=false">Хүсэлт</button>
<span id="c2" hidden><button onclick="fetch('/request',{method:'POST'})">Тийм</button></span>
<button onclick="document.getElementById('s').textContent='filtered'">Шүүх</button>
</main></body></html>`;

test('safety: an inline seal and its confirmation outside a dialog are never clicked', async () => {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.writeHead(req.url === '/' ? 200 : 204, { 'content-type': 'text/html' }); res.end(req.url === '/' ? PAGE : '');
  }).listen(0);
  try {
    const r = await tunnel({ url: `http://127.0.0.1:${srv.address().port}/`, name: 't-safety', max: 20, depth: 0, stateDepth: 2, checkDesign: false, locate: false });
    assert.deepEqual(hits.filter((h) => h.startsWith('POST')), [], 'nothing was sealed or confirmed');
    assert.ok(!r.steps.some((s) => /"(Лацдах|Тийм, лацдах|Тийм)"/.test(s.target)));
    assert.ok(r.steps.some((s) => s.target === 'button "Шүүх"' && s.changed), 'harmless controls are still tested');
    assert.ok(r.steps.some((s) => s.target === 'button "Хүсэлт"'), 'the button that reveals the confirmation is tested');
    assert.ok(r.coverage.skippedByLabelRule >= 2, 'the skipped controls are counted, not hidden');
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('isStructurallySafe: tabs, accordions, same-origin links and a dialog\'s own close need no model', () => {
  const { isStructurallySafe } = flowRules;
  assert.ok(isStructurallySafe({ role: 'tab', label: 'Хүсэлт' }));
  assert.ok(isStructurallySafe({ role: 'summary', label: 'More options' }));
  assert.ok(isStructurallySafe({ role: 'link', label: 'Нээх', target: '/apps/netwrk-web/branch/requests' }));
  assert.ok(isStructurallySafe({ role: 'button', label: 'Хаах', inDialog: true }));
  assert.ok(isStructurallySafe({ role: 'button', label: 'Close modal', inDialog: true }));
  assert.ok(!isStructurallySafe({ role: 'link', label: 'Exit', target: '/account/logout' }), 'a risky path still goes to the screen');
  assert.ok(!isStructurallySafe({ role: 'link', label: 'Docs', target: '' }));
  assert.ok(!isStructurallySafe({ role: 'button', label: 'Бүртгэл хаах', inDialog: true }), 'closing an account is not closing the dialog');
  assert.ok(!isStructurallySafe({ role: 'button', label: 'Хаах' }), 'a bare "Close" outside a dialog may close a case');
  assert.ok(!isStructurallySafe({ role: 'button', label: 'Салбарын үйл ажиллагаа', global: true }), 'buttons go to the model, with context');
});

test('riskContext: tells the model where the control sits and on which page', () => {
  const { riskContext } = flowRules;
  assert.equal(riskContext({ global: true }, { page: '/a' }), 'in the app navigation (sidebar, header or footer), on page /a');
  assert.equal(riskContext({ inDialog: true }, { page: '/a', state: 'dialog "Add user"' }), 'inside dialog "Add user", on page /a');
  assert.equal(riskContext({ target: '/b' }, { page: '/a' }), 'in the page content, links to /b, on page /a');
});

// No model keys in tests: the screen fails safe and skips every control it is asked about. Same-origin links never
// reach it. The picker takes buttons before links, so the six screened buttons come first and must not use up the
// click budget meant for the links.
const BUSY = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Busy</title></head><body><main><h1>Busy</h1>
${[1, 2, 3, 4, 5, 6].map((i) => `<button>Action ${i}</button>`).join(' ')}
<a href="/one">One</a> <a href="/two">Two</a></main></body></html>`;

test('risk screen: structural controls skip the model, and what the screen keeps back costs no click budget', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(BUSY); }).listen(0);
  try {
    const r = await tunnel({ url: `http://127.0.0.1:${srv.address().port}/`, name: 't-risk-budget', max: 2, depth: 0, riskScreen: true, checkDesign: false, locate: false });
    const clicked = r.steps.filter((s) => !s.skipped).map((s) => s.target);
    assert.deepEqual(clicked.sort(), ['link "One"', 'link "Two"'], 'both links are clicked within max 2 although six buttons were screened first');
    assert.equal(r.coverage.skippedByRiskScreen, 6);
    assert.equal(r.coverage.exercised, 2);
  } finally { srv.closeAllConnections(); srv.close(); }
});
