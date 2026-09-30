// Launch Chromium. Default: Playwright's own browser (npx playwright install chromium).
// Fallbacks: CHROMIUM_PATH env var, then any chromium under PLAYWRIGHT_BROWSERS_PATH, then installed Chrome / Edge.
import '../core/env.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { NotRunError } from '../core/errors.mjs';

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

export async function launchBrowser({ headless = true, slowMo = 0, onNote = () => {} } = {}) {
  const args = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
  // MOLE_HEADLESS=1 never opens a window (CI machines, tests), even when a run asks to be watched.
  const base = { headless: headless || /^(1|true|yes)$/i.test(process.env.MOLE_HEADLESS || ''), args, ...(slowMo ? { slowMo } : {}) };
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return chromium.launch({ ...base, executablePath: explicit });
  try {
    return await chromium.launch(base);
  } catch (err) {
    const fallback = findPreinstalled();
    if (fallback) { onNote(`default Chromium missing, using ${fallback}`); return chromium.launch({ ...base, executablePath: fallback }); }
    // Managed laptops often block the Chromium download. An installed Chrome or Edge works the same.
    for (const channel of ['chrome', 'msedge']) {
      try { const b = await chromium.launch({ ...base, channel }); onNote(`Playwright Chromium missing, using installed ${channel}`); return b; } catch { /* try next */ }
    }
    throw err;
  }
}

// Pages behind login: a Playwright storageState file made from a test account, kept OUTSIDE the repo.
// A path that does not exist is NOT_RUN, never a silent anonymous run.
export function resolveStorageState(file) {
  if (!file) return {};
  const abs = path.resolve(file.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!fs.existsSync(abs)) throw new NotRunError(`storage state file not found: ${abs}`);
  return { storageState: abs };
}

// Name of the app's own sign-in button (see loadChecked), as a case-insensitive regex.
export const toSsoRegex = (v) => (v ? new RegExp(v, 'i') : null);

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
