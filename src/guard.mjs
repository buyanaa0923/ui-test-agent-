// A test that could not run must never look like a pass. Load the page, and say plainly when it did not load or rendered nothing.

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|sso|auth|oauth2?|realms)(\/|$|\?)/i;
const LOGIN_TEXT = [
  /нэвтрэх шаардлагатай/i, /нэвтэрсэн хэрэглэгч шаардда/i, /нэвтэрнэ үү/i, // Mongolian: login required / requires a signed-in user / please log in
  /sign in to continue/i, /log ?in (is )?required/i, /you must (be )?(logged|signed) in/i, /session (has )?expired/i,
];

// The page we landed on is a login wall, not the page we were asked to test. Testing it would report on the wall.
// Pure function so it is unit-testable. Asking for a login page on purpose is allowed.
export function detectAuthWall({ requestedUrl, finalUrl, hasPasswordField, text }) {
  const path = (u) => { try { return new URL(u).pathname + new URL(u).search; } catch { return u; } };
  const wantedLogin = LOGIN_PATH.test(path(requestedUrl));
  if (wantedLogin) return null;
  if (LOGIN_PATH.test(path(finalUrl)) && finalUrl !== requestedUrl) return `redirected to a login/identity page (${path(finalUrl).slice(0, 80)})`;
  if (hasPasswordField) return 'a password field is on screen - this is a login form, not the requested page';
  const hit = LOGIN_TEXT.find((re) => re.test(text || ''));
  if (hit) return `the page says login is required (matched ${hit})`;
  return null;
}

const probeWall = async (page, url) => {
  const probe = await page.evaluate(() => ({ hasPasswordField: !!document.querySelector('input[type=password]'), text: (document.body?.innerText || '').slice(0, 3000) })).catch(() => null);
  return probe ? detectAuthWall({ requestedUrl: url, finalUrl: page.url(), ...probe }) : null;
};

// ssoButton: for apps that keep the access token in memory only (so a saved cookie session is not enough on a fresh load):
// click the app's own sign-in button once, let it complete with the saved identity-provider session, then re-check. Still walled = NOT_RUN.
export async function loadChecked(page, url, { waitUntil = 'networkidle', timeout = 30000, minElements = 5, ssoButton = null } = {}) {
  let status = null, error = null;
  try {
    const res = await page.goto(url, { waitUntil, timeout });
    status = res ? res.status() : null;
  } catch (e) {
    error = e.message.split('\n')[0];
  }
  // SPAs render after load: give the app a few seconds to put something on screen.
  const count = () => page.evaluate(() => document.querySelectorAll('body *').length).catch(() => 0);
  let n = await count();
  for (let i = 0; i < 10 && n < minElements && !error; i++) { await page.waitForTimeout(500); n = await count(); }
  let problem = null;
  let wall = null;
  if (!error && !(status && status >= 400)) {
    wall = await probeWall(page, url);
    if (wall && ssoButton) {
      const btn = page.getByRole('button', { name: ssoButton }).or(page.getByRole('link', { name: ssoButton })).first();
      if (await btn.count()) {
        await btn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
        await page.waitForTimeout(1000);
        wall = await probeWall(page, url);
        n = await count();
      }
    }
  }
  if (wall) problem = `${url} needs login: ${wall}. Nothing was tested. Provide a test account (--storage-state) or scan the login page on purpose.`;
  else if (error) problem = `could not load ${url}: ${error}`;
  else if (status && status >= 400) problem = `${url} answered HTTP ${status}`;
  else if (n < minElements) problem = `${url} loaded (HTTP ${status}) but rendered only ${n} element(s) - blank page, app crashed, or needs a login`;
  return { ok: !problem, problem, status, elements: n };
}
