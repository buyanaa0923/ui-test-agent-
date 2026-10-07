import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { tunnel } = await import('../../src/engine/tunnel.mjs');

// A SPA whose screen arrives in a lazily imported chunk, after the load event (like a Vite app with lazy routes or a
// federated module). Every click is followed by a reload of the page, so each reload must wait for the chunk again.
const SHELL = `<!doctype html><html lang="en"><head><title>Workspace</title></head><body><div id="root"></div>
<script type="module">import('/chunk.js');</script></body></html>`;
const CHUNK = `document.getElementById('root').innerHTML = '<main><h1>Workspace</h1><p id="s">ready</p>'
  + '<button id="go">Branch</button> <button id="tg">Toggle</button> <button id="hi">Highlight</button></main>';
document.getElementById('go').onclick = () => { history.pushState({}, '', '/branch'); document.querySelector('h1').textContent = 'Branch'; };
document.getElementById('tg').onclick = () => { document.getElementById('s').textContent = 'toggled'; };
document.getElementById('hi').onclick = () => { document.getElementById('s').textContent = 'highlighted'; };`;

async function app(fn, { blankAfter = Infinity } = {}) {
  let loads = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (req.url === '/chunk.js') return setTimeout(() => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(CHUNK); }, 600);
    loads++;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(loads > blankAfter ? '<!doctype html><html><body></body></html>' : SHELL);
  }).listen(0);
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.closeAllConnections(); srv.close(); }
}

test('reload: a SPA that renders after load is waited for on every reload, so every control is tested', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-reload', max: 10, depth: 0, checkDesign: false, locate: false });
  const page = r.coverage.pages[0];
  assert.equal(page.controls, 3, 'the controls are found after each reload, not only on the first load');
  assert.equal(page.exercised, 3);
  assert.equal(page.stop, 'all-controls-tested');
}));

test('reload: a page left blank after a reload is a failed replay with its reason, never "all controls tested"', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-reload-blank', max: 10, depth: 0, checkDesign: false, locate: false });
  const page = r.coverage.pages[0];
  assert.equal(page.exercised, 1, 'the first click ran on the first load');
  assert.equal(page.stop, 'replay-failed');
  assert.match(page.problem, /rendered only \d element\(s\) when reloaded/);
  assert.equal(r.coverage.stopReason, 'replay-failed');
}, { blankAfter: 1 }));
