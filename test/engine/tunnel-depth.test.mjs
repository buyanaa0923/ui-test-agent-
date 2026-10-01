import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1';
const { tunnel } = await import('../../src/engine/tunnel.mjs');
const { EventBus } = await import('../../src/core/events.mjs');
const { groupFindings } = await import('../../src/core/findings.mjs');
const { routeKey, pathOf, isRiskyPath, isAuthPath, arrivalProblem, dropNavLoadErrors } = await import('../../src/engine/flow-rules.mjs');

// ---- pure rules ----

test('routeKey: ids, trailing slashes and query values collapse; query keys and hash routes do not', () => {
  assert.equal(routeKey('http://x/users/17'), routeKey('http://x/users/18/'));
  assert.equal(routeKey('http://x/o/3f2b1c9e-8a7d-4e6f-9b0a-1c2d3e4f5a6b'), 'http://x/o/:id');
  assert.equal(routeKey('http://x/list?page=2'), routeKey('http://x/list?page=9'));
  assert.notEqual(routeKey('http://x/list?tab=a'), routeKey('http://x/list'));
  assert.notEqual(routeKey('http://x/#/a'), routeKey('http://x/#/b'), 'hash-router routes are pages');
  assert.equal(routeKey('http://x/page#section'), routeKey('http://x/page'), 'an in-page anchor is not a page');
  assert.equal(pathOf('http://x/a/b?c=1'), '/a/b?c=1');
});

test('risky and auth paths: /logout is skipped, /payments is not', () => {
  assert.ok(isRiskyPath('/account/logout')); assert.ok(isRiskyPath('/items/4/delete?x=1'));
  assert.ok(!isRiskyPath('/payments')); assert.ok(!isRiskyPath('/deleted-items-report'));
  assert.ok(isAuthPath('http://x/login?next=/')); assert.ok(!isAuthPath('http://x/authors'));
});

test('arrivalProblem: HTTP error, login redirect, blank, soft 404, and a healthy page', () => {
  const ok = { title: 'Loans', headings: ['Loans'], elements: 40, text: 'Loans table' };
  assert.equal(arrivalProblem({ status: 404, finalUrl: 'http://x/gone' }).rule, 'broken-link');
  assert.equal(arrivalProblem({ requestedUrl: 'http://x/settings', finalUrl: 'http://x/login', probe: ok }).rule, 'lands-on-login');
  assert.equal(arrivalProblem({ requestedUrl: 'http://x/login', finalUrl: 'http://x/login', probe: ok }), null, 'a "Sign in" link going to /login is fine');
  assert.equal(arrivalProblem({ finalUrl: 'http://x/a', probe: { ...ok, elements: 2 } }).rule, 'blank-page');
  assert.equal(arrivalProblem({ finalUrl: 'http://x/a', probe: { ...ok, headings: ['404', 'This page could not be found.'] } }).rule, 'not-found-page');
  assert.equal(arrivalProblem({ finalUrl: 'http://x/a', probe: { ...ok, title: 'Хуудас олдсонгүй' } }).rule, 'not-found-page');
  assert.equal(arrivalProblem({ finalUrl: 'http://x/a', probe: { ...ok, text: 'Found 3 loans. Password reset is in settings.' } }), null);
  assert.equal(arrivalProblem({ status: 200, finalUrl: 'http://x/a', probe: ok }), null);
});

test('dropNavLoadErrors: the console line for a failed page load is not a second defect; other errors stay', () => {
  const load = 'console: Failed to load resource: the server responded with a status of 404 (Not Found)';
  assert.deepEqual(dropNavLoadErrors([load, 'pageerror: x is undefined'], 1), ['pageerror: x is undefined']);
  assert.deepEqual(dropNavLoadErrors([load, load], 1), [load], 'only as many as pages that failed');
  assert.deepEqual(dropNavLoadErrors([load], 0), [load]);
});

// ---- a small multi-page app, explored in a real browser ----

const NAV = '<nav><a href="/">Home</a> <a href="/a">Alpha</a> <a href="/b">Beta</a> <a href="/gone">Gone</a> <a href="/soft">Soft</a> <a href="/logout">Exit</a></nav>';
const shell = (h1, main) => `<!doctype html><html lang="en"><head><title>${h1}</title></head><body>${NAV}<main><h1>${h1}</h1><p>Some text.</p><p id="s" role="status"></p>${main}</main></body></html>`;
const ROUTES = {
  '/': shell('Home', '<button>Edit</button>'), // dead
  '/a': shell('Alpha', '<button>Nothing</button> <a href="/a/deep">Deeper</a>'), // dead + link one level further
  '/a/deep': shell('Deep', '<button onclick="document.getElementById(\'s\').textContent=\'ok\'">Go</button>'),
  '/b': shell('Beta', '<button onclick="document.getElementById(\'s\').textContent=\'saved\'">Edit</button>'), // same label as the dead one on /, but works
  '/soft': shell('Page not found', '<p>Try the home page.</p>'), // a client-side 404 that answers 200
};

async function app(fn, routes = ROUTES) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const body = routes[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body || '<!doctype html><body><h1>Nope</h1><p>1</p><p>2</p><p>3</p><p>4</p><p>5</p></body>');
  }).listen(0);
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, hits); } finally { srv.closeAllConnections(); srv.close(); }
}

const has = (r, rule, element) => r.findings.some((f) => f.rule === rule && f.element === element);

test('depth 2: follows the pages clicks reach, checks where each link lands, keeps per-page buttons apart', async () => app(async (origin, hits) => {
  const bus = new EventBus();
  const r = await tunnel({ url: `${origin}/`, name: 't-depth', depth: 2, max: 40 }, { bus });
  const visited = r.coverage.pages.filter((p) => p.stop !== 'not-reached').map((p) => p.path);
  assert.deepEqual(visited, ['/', '/a', '/b', '/a/deep'], 'breadth first: the start page, the pages its links reach, then one level deeper');
  assert.equal(r.coverage.pages.find((p) => p.path === '/a/deep').from, 'link "Deeper" on /a');
  assert.ok(has(r, 'broken-link', 'link "Gone"'), 'link to a 404');
  assert.ok(!r.findings.some((f) => f.element === 'link "Gone"' && f.rule === 'js-error'), 'the 404 is one defect, not also a JS error');
  assert.ok(has(r, 'not-found-page', 'link "Soft"'), 'link to a page that says it was not found');
  assert.ok(has(r, 'dead-click', 'button "Edit"'), 'the dead Edit on the start page');
  assert.ok(has(r, 'dead-click', 'button "Nothing" on /a'), 'a dead button on a page reached by a click');
  assert.ok(!r.findings.some((f) => f.element === 'button "Edit" on /b'), 'Edit on /b is its own control, and it works');
  assert.ok(!hits.includes('/logout'), 'a link to /logout is never followed');
  assert.equal(r.coverage.skippedByPathRule, 1);
  assert.equal(r.findings.filter((f) => f.element === 'link "Alpha"').length, 0, 'nav links are clicked once for the whole run, and work');
  assert.equal(r.coverage.stopReason, 'all-controls-tested');
  assert.equal(r.exitCode, 1);
  const t = bus.history.map((e) => e.type);
  assert.equal(t.filter((x) => x === 'page.enter').length, 4); assert.equal(t.filter((x) => x === 'page.found').length, 3);
}));

test('depth 0 stays on the start page, but still judges where its links land', async () => app(async (origin, hits) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-depth0', max: 40 });
  assert.equal(r.coverage.pagesVisited, 1);
  assert.deepEqual(r.coverage.pages.map((p) => p.path), ['/']);
  assert.ok(has(r, 'broken-link', 'link "Gone"'));
  assert.ok(!r.findings.some((f) => /Nothing/.test(f.element)), 'buttons on /a are not explored');
  assert.ok(!hits.includes('/a/deep'));
}));

test('depth 1 finds /a/deep but does not explore it, and says so', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-depth1', depth: 1, max: 40 });
  assert.ok(r.coverage.pagesBeyondDepth.includes('/a/deep'));
  assert.ok(!r.coverage.pages.some((p) => p.path === '/a/deep'));
}));

test('the click budget is shared across pages and ends the run as max-steps', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-depth-budget', depth: 2, max: 3 });
  assert.equal(r.coverage.exercised + r.coverage.skippedByRiskScreen, 3);
  assert.equal(r.coverage.stopReason, 'max-steps');
  assert.ok(r.coverage.pagesNotReached >= 1, 'pages found but not explored are reported, not hidden');
}));

// ---- design checks on every page the explorer reaches ----

// The nav link is too faint on EVERY page (one defect, not one per page); /b alone has an unlabelled input.
const FAINT_NAV = '<nav><a href="/" style="color:#b0b0b0">Home</a> <a href="/b" style="color:#111">Beta</a></nav>';
const page = (h1, main) => `<!doctype html><html lang="en"><head><title>${h1}</title><style>body{font-family:Inter,sans-serif;font-size:16px;line-height:1.5;color:#111;background:#fff}</style></head><body>${FAINT_NAV}<main><h1>${h1}</h1><p>Some text.</p><p id="s" role="status"></p>${main}</main></body></html>`;
const DESIGN_ROUTES = {
  '/': page('Home', '<button onclick="document.getElementById(\'s\').textContent=\'ok\'">Save</button>'),
  '/b': page('Beta', '<input type="text"> <button onclick="document.getElementById(\'s\').textContent=\'ok\'">Go</button>'),
};

test('checkDesign: every page reached is design-checked; a shell defect on every page is one defect, a page defect names its page', async () => app(async (origin) => {
  const dir = tmpDir('mole-design-'); const design = path.join(dir, 'DESIGN.md');
  fs.writeFileSync(design, '# Design: test\n\n```mole\nextends: modern-web\n```\n');
  const bus = new EventBus();
  const r = await tunnel({ url: `${origin}/`, name: 't-depth-design', depth: 1, max: 20, checkDesign: true, design, locate: false }, { bus });
  assert.equal(r.coverage.pagesDesignChecked, 2);
  assert.deepEqual(r.coverage.pages.map((p) => [p.path, p.elements > 0, p.modesSkipped]), [['/', true, ['dark']], ['/b', true, ['dark']]], 'no dark mode on either page: checked in light only');
  const faint = r.findings.filter((f) => f.rule === 'contrast' && f.text === 'Home');
  assert.deepEqual(faint.map((f) => f.page).sort(), ['/', '/b'], 'measured on both pages');
  assert.equal(groupFindings(faint).length, 1, '...and counted as one defect');
  assert.equal(new Set(faint.map((f) => f.key)).size, 2, 'keys stay unique per page');
  const unlabeled = r.findings.filter((f) => f.rule === 'control-unlabeled');
  assert.equal(unlabeled.length, 1); assert.equal(unlabeled[0].page, '/b');
  assert.ok(!r.findings.some((f) => f.mode === 'flow'), 'every control works');
  assert.equal(r.exitCode, 1);
  const rep = JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8'));
  assert.ok(rep.contract?.name && rep.stamp?.contractHash, 'the report names and stamps the contract');
  assert.ok(fs.existsSync(path.join(r.runDir, 'page-01-light.png')) && fs.existsSync(path.join(r.runDir, 'page-02-light.png')));
  const measured = bus.history.filter((e) => e.type === 'page.measured');
  assert.deepEqual(measured.map((e) => e.path), ['/', '/b']);
  assert.ok(bus.history.filter((e) => e.type === 'finding' && e.mode !== 'flow').every((e) => e.page), 'design findings carry their page');
  const firstClick = bus.history.findIndex((e) => e.type === 'control.click');
  assert.ok(bus.history.findIndex((e) => e.type === 'page.measured') < firstClick, 'a page is measured before anything is clicked on it');
}, DESIGN_ROUTES));

test('checkDesign off (the engine default): no design findings, no contract', async () => app(async (origin) => {
  const r = await tunnel({ url: `${origin}/`, name: 't-depth-nodesign', depth: 1, max: 20 });
  assert.ok(r.findings.every((f) => f.mode === 'flow'));
  assert.equal(r.contract, undefined); assert.equal(r.coverage.pagesDesignChecked, 0);
}, DESIGN_ROUTES));

// ---- style consistency across the pages reached ----

test('checkDesign: a page that passes every rule but does not look like the rest of the site is reported, as advisory', async () => {
  const { generateSites } = await import('../../bench/style-sites.mjs');
  const site = generateSites({ seed: 3 }).find((c) => c.base === 'swiss' && c.mutation === 'off-style' && c.pages.length >= 5);
  const nav = `<nav>${site.pages.map((p) => `<a href="${p.path}">${p.type} ${p.path}</a>`).join(' ')}</nav>`;
  const routes = Object.fromEntries(site.pages.map((p) => [p.path, p.html.replace(/<header[\s\S]*?<\/header>/, nav)]));
  const odd = site.pages.find((p) => p.odd).path;
  await app(async (origin) => {
    const dir = tmpDir('mole-design-'); const design = path.join(dir, 'DESIGN.md');
    fs.writeFileSync(design, '# Design: test\n\n```mole\nextends: modern-web\n```\n');
    const bus = new EventBus();
    const r = await tunnel({ url: `${origin}/`, name: 't-depth-style', depth: 1, max: 80, maxPerPage: 12, checkDesign: true, design, locate: false, modes: ['light'] }, { bus });
    assert.equal(r.coverage.pagesDesignChecked, site.pages.length, 'every page reached and measured');
    assert.ok(r.consistency.checked);
    assert.deepEqual(r.consistency.outliers.map((o) => o.path), [odd], 'the off-style page, and only it');
    assert.ok(r.consistency.outliers[0].differences.some((d) => d.family === 'corners'));
    assert.ok(!r.findings.some((f) => f.mode !== 'flow'), 'it breaks no design rule: only the comparison sees it');
    assert.ok(!r.findings.some((f) => /style/.test(f.rule)), 'advisory: not a defect, not in the exit code');
    assert.equal(bus.history.filter((e) => e.type === 'consistency').length, 1);
    assert.ok(JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8')).consistency.outliers.length === 1);
  }, routes);
});
