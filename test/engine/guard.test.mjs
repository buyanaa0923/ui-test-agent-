import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { detectAuthWall, loadChecked } from '../../src/engine/guard.mjs';
import { launchBrowser } from '../../src/engine/browser.mjs';

const base = { requestedUrl: 'http://localhost:5200/apps/x/sales', finalUrl: 'http://localhost:5200/apps/x/sales', hasPasswordField: false, text: 'Sales table' };

test('a normal page is not an auth wall', () => assert.equal(detectAuthWall(base), null));
test('redirect to a login path is an auth wall', () => assert.match(detectAuthWall({ ...base, finalUrl: 'http://localhost:5181/login' }), /login/i));
test('redirect to an identity provider is an auth wall', () => assert.ok(detectAuthWall({ ...base, finalUrl: 'http://kc:8080/realms/netos/protocol/openid-connect/auth?x=1' })));
test('password field on a page nobody asked to be a login page is an auth wall', () => assert.ok(detectAuthWall({ ...base, hasPasswordField: true })));
test('Mongolian "login required" notice is an auth wall', () => assert.ok(detectAuthWall({ ...base, text: 'NetWork — нэвтрэх шаардлагатай Энэ апп NetOS SSO-гоор нэвтэрсэн хэрэглэгч шаардаг.' })));
test('English "sign in to continue" notice is an auth wall', () => assert.ok(detectAuthWall({ ...base, text: 'Please sign in to continue' })));
test('asking for the login page itself is allowed', () => {
  const r = { requestedUrl: 'http://localhost:5181/login', finalUrl: 'http://localhost:5181/login', hasPasswordField: true, text: 'Нэвтрэх' };
  assert.equal(detectAuthWall(r), null);
});

test('loadChecked reports NOT_RUN for a route that redirects to /login (real browser)', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/secret') { res.writeHead(302, { location: '/login' }); return res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end('<body><h1>x</h1><p>1</p><p>2</p><p>3</p><p>4</p><p>5</p><p>6</p></body>');
  }).listen(0);
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const gated = await loadChecked(page, `${origin}/secret`);
    assert.equal(gated.ok, false);
    assert.match(gated.problem, /login/i);
    const open = await loadChecked(page, `${origin}/public`);
    assert.equal(open.ok, true);
  } finally { await browser.close(); srv.close(); }
});

test('with an SSO button configured, loadChecked signs in through it; without success it stays NOT_RUN (real browser)', async () => {
  const html = (body) => `<body>${body}<p>1</p><p>2</p><p>3</p><p>4</p><p>5</p></body>`;
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/works') return res.end(html('<h1>Login required, please sign in to continue</h1><button id=b onclick="document.querySelector(\'h1\').textContent=\'Sales table\'">Sign in with SSO</button>'));
    if (req.url === '/broken') return res.end(html('<h1>Login required, please sign in to continue</h1><button>Sign in with SSO</button>'));
    res.end(html('<h1>x</h1>'));
  }).listen(0);
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const noSso = await loadChecked(page, `${origin}/works`);
    assert.equal(noSso.ok, false);
    const ok = await loadChecked(page, `${origin}/works`, { ssoButton: /sso/i });
    assert.equal(ok.ok, true);
    const still = await loadChecked(page, `${origin}/broken`, { ssoButton: /sso/i });
    assert.equal(still.ok, false);
    assert.match(still.problem, /login/i);
  } finally { await browser.close(); srv.close(); }
});
