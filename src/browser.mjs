// Launch Chromium. Default: Playwright's own browser (npx playwright install chromium).
// Fallbacks: CHROMIUM_PATH env var, then any chromium under PLAYWRIGHT_BROWSERS_PATH, then installed Chrome / Edge.
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function findPreinstalled() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    for (const sub of ['chrome-linux', 'chrome-linux64']) {
      const exe = path.join(base, d, sub, 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

export async function launchBrowser({ headless = true } = {}) {
  const args = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return chromium.launch({ headless, args, executablePath: explicit });
  try {
    return await chromium.launch({ headless, args });
  } catch (err) {
    const fallback = findPreinstalled();
    if (fallback) { console.warn(`[browser] default Chromium missing, using ${fallback}`); return chromium.launch({ headless, args, executablePath: fallback }); }
    // Managed laptops often block the Chromium download. An installed Chrome or Edge works the same.
    for (const channel of ['chrome', 'msedge']) {
      try { const b = await chromium.launch({ headless, args, channel }); console.warn(`[browser] Playwright Chromium missing, using installed ${channel}`); return b; } catch { /* try next */ }
    }
    throw err;
  }
}

// Pages behind login: a Playwright storageState file made from a test account, kept OUTSIDE the repo.
// --storage-state <file> or UTA_STORAGE_STATE. A path that does not exist is an error (NOT_RUN), never a silent anonymous run.
export function storageStateOption(argv = process.argv) {
  const i = argv.indexOf('--storage-state');
  const file = i >= 0 ? argv[i + 1] : process.env.UTA_STORAGE_STATE;
  if (!file) return {};
  const abs = path.resolve(file.replace(/^~(?=$|\/)/, process.env.HOME || '~'));
  if (!fs.existsSync(abs)) { console.error(`NOT RUN: storage state file not found: ${abs}`); process.exit(2); }
  return { storageState: abs };
}

// --sso-button <regex> or UTA_SSO_BUTTON: name of the app's own sign-in button (see loadChecked).
export function ssoButtonOption(argv = process.argv) {
  const i = argv.indexOf('--sso-button');
  const v = i >= 0 ? argv[i + 1] : process.env.UTA_SSO_BUTTON;
  return v ? new RegExp(v, 'i') : null;
}

// Height the viewport must have for the WHOLE page to be on screen. App shells (height: 100vh with an inner overflow container)
// hide most content from documentElement.scrollHeight; look at inner scroll containers too.
export function neededPageHeight(page) {
  return page.evaluate(() => {
    let extra = 0;
    for (const el of document.querySelectorAll('body *')) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) extra = Math.max(extra, el.scrollHeight - el.clientHeight);
    }
    return Math.max(document.documentElement.scrollHeight, window.innerHeight + extra);
  });
}
