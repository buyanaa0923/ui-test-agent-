import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { tunnel } = await import('../../src/engine/tunnel.mjs');
const { EventBus } = await import('../../src/core/events.mjs');

// One page with everything that opens without a URL: a dialog (with a nested dialog), the same dialog behind two
// table rows, tabs, an accordion, a dialog "Save" that must never be clicked, and a form that must never be submitted.
const dlg = (id, name, body) => `<div id="${id}" role="dialog" aria-modal="true" aria-label="${name}" hidden style="position:fixed;top:40px;left:40px;background:#fff;border:1px solid #333;padding:16px">${body}</div>`;
const PAGE = `<!doctype html><html lang="en"><head><title>Users</title><style>body{font-family:Inter,sans-serif;font-size:16px;line-height:1.5;color:#111;background:#fff}</style></head><body>
<main><h1>Users</h1><p id="s" role="status"></p>
<button onclick="show('dlg-add', true)">Add user</button>
<table><tr><td>Ann</td><td><button onclick="show('dlg-edit', true)">Edit</button></td></tr><tr><td>Bat</td><td><button onclick="show('dlg-edit', true)">Edit</button></td></tr></table>
<div role="tablist"><button role="tab" aria-selected="true" aria-controls="p-over" id="t-over">Overview</button> <button role="tab" aria-selected="false" aria-controls="p-bill" id="t-bill" onclick="tab()">Billing</button></div>
<div id="p-over" role="tabpanel"><p>Overview text.</p></div>
<div id="p-bill" role="tabpanel" hidden><p style="color:#bbbbbb">Invoices are monthly.</p><button>Download invoice</button></div>
<details><summary>More options</summary><button onclick="document.getElementById('s').textContent='expanded'">Expand all</button></details>
<form action="/search"><label for="q">Search</label> <input id="q" name="q"> <button>Search</button></form>
</main>
${dlg('dlg-add', 'Add user', '<h2>Add user</h2><input type="text"> <button onclick="show(\'dlg-add\', false)">Close</button> <button>Help</button> <button onclick="show(\'dlg-adv\', true)">Advanced</button> <button onclick="fetch(\'/saved\')">Save</button>')}
${dlg('dlg-edit', 'Edit item', '<h2>Edit item</h2><button onclick="show(\'dlg-edit\', false)">Close</button>')}
${dlg('dlg-adv', 'Advanced settings', '<h2>Advanced settings</h2><button onclick="show(\'dlg-adv\', false)">Close</button> <button>Nothing here</button>')}
<script>
function show(id, on) { document.getElementById(id).hidden = !on; }
function tab() { document.getElementById('p-bill').hidden = false; document.getElementById('p-over').hidden = true; document.getElementById('t-bill').setAttribute('aria-selected', 'true'); document.getElementById('t-over').setAttribute('aria-selected', 'false'); }
</script></body></html>`;

async function app(fn) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    res.writeHead(req.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); res.end(req.url === '/' ? PAGE : '<body><h1>Nope</h1></body>');
  }).listen(0);
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, hits); } finally { srv.closeAllConnections(); srv.close(); }
}
const design = () => { const d = tmpDir('mole-design-'); const f = path.join(d, 'DESIGN.md'); fs.writeFileSync(f, '# Design: test\n\n```mole\nextends: modern-web\n```\n'); return f; };
const has = (r, rule, element) => r.findings.some((f) => f.rule === rule && f.element === element);

test('states: dialogs, a nested dialog, tabs and an accordion are opened, tested and design-checked; nothing is committed or submitted', async () => app(async (origin, hits) => {
  const bus = new EventBus();
  const r = await tunnel({ url: `${origin}/`, name: 't-states', max: 40, stateDepth: 2, checkDesign: true, design: design(), locate: false }, { bus });
  const states = r.coverage.pages[0].states;
  assert.deepEqual(states.map((s) => [s.label, s.depth, s.stop]).sort(), [
    ['dialog "Add user"', 1, 'all-controls-tested'],
    ['dialog "Advanced settings"', 2, 'all-controls-tested'],
    ['dialog "Edit item"', 1, 'all-controls-tested'],
    ['summary "More options" open', 1, 'all-controls-tested'],
    ['tab "Billing" open', 1, 'all-controls-tested'],
  ].sort(), 'each state once: the dialog behind two "Edit" rows is one state; the nested dialog is reached by replaying two clicks');
  assert.equal(states.find((s) => s.label === 'dialog "Advanced settings"').from, 'button "Advanced" in dialog "Add user"');

  assert.ok(!r.findings.some((f) => f.rule === 'click-failed'), 'nothing hidden (e.g. inside a closed <details>) is clicked');
  assert.ok(r.steps.some((s) => s.target === 'button "Expand all"' && s.state === 'summary "More options" open' && s.changed), 'the accordion\'s button is tested once the accordion is open');
  assert.ok(has(r, 'dead-click', 'button "Help" in dialog "Add user"'), 'a dead button inside a dialog');
  assert.ok(has(r, 'dead-click', 'button "Download invoice" in tab "Billing" open'), 'a dead button inside a tab panel');
  assert.ok(has(r, 'dead-click', 'button "Nothing here" in dialog "Advanced settings"'), 'a dead button two dialogs deep');
  const closes = r.steps.filter((s) => s.target === 'button "Close"').map((s) => s.state);
  assert.deepEqual(closes.sort(), ['dialog "Add user"', 'dialog "Advanced settings"', 'dialog "Edit item"'], '"Close" in three dialogs is three controls');
  assert.ok(!r.findings.some((f) => /Close/.test(f.element)), 'and each Close works');

  assert.ok(!hits.includes('/saved'), 'the dialog\'s Save was never clicked');
  assert.ok(!hits.some((u) => u.startsWith('/search')), 'the form was never submitted');
  assert.ok(r.coverage.skippedDialogCommit >= 1 && r.coverage.skippedSubmit >= 1);
  assert.ok(!r.steps.some((s) => /"(Save|Search)"/.test(s.target)));

  const unlabeled = r.findings.filter((f) => f.rule === 'control-unlabeled');
  assert.deepEqual(unlabeled.map((f) => f.state), ['dialog "Add user"'], 'the input in the dialog is measured in the dialog, not on the page behind it');
  assert.ok(r.findings.some((f) => f.rule === 'contrast' && f.state === 'tab "Billing" open' && /Invoices/.test(f.text)), 'the faint text in the tab panel');
  assert.ok(!r.findings.some((f) => f.mode !== 'flow' && f.state === 'dialog "Add user"' && f.text === 'Users'), 'the page behind the dialog is not measured again');
  assert.ok(r.coverage.statesDesignChecked >= 4);
  assert.ok(fs.readdirSync(r.runDir).some((f) => /^page-01-s\d-light\.png$/.test(f)));

  const t = bus.history.map((e) => e.type);
  assert.equal(t.filter((x) => x === 'state.found').length, 5); assert.equal(t.filter((x) => x === 'state.enter').length, 5);
  assert.equal(r.coverage.stopReason, 'all-controls-tested');
}));

test('stateDepth 0 (the engine default): a dialog opens and counts as working, but nothing inside it is tested', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-states-off', max: 40 });
  assert.equal(r.coverage.statesFound, 0);
  assert.ok(!r.steps.some((s) => s.state));
  assert.ok(r.steps.find((s) => s.target === 'button "Add user"').dialogOpened, 'the open dialog is seen');
}));

test('stateDepth 1: the nested dialog is found only two clicks deep, so it is not explored', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-states-1', max: 40, stateDepth: 1 });
  assert.ok(!r.coverage.pages[0].states.some((s) => s.label === 'dialog "Advanced settings"'));
  assert.ok(r.steps.some((s) => s.target === 'button "Advanced"' && s.dialogOpened), 'its button was still clicked and worked');
}));
