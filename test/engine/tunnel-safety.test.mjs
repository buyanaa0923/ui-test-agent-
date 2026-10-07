import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { tunnel } = await import('../../src/engine/tunnel.mjs');
const { isRiskyLabel } = await import('../../src/engine/flow-rules.mjs');

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
