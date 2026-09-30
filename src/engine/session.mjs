// One browser session for a run: launch, context, page, optional video, optional presenter (browser overlay).
// The engine never imports from src/ui: a caller that wants a presenter passes `attach`, which receives the
// live context/page and returns an object with hide()/show() (or nothing).
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, resolveStorageState } from './browser.mjs';

// mobile: emulate a phone (touch, mobile viewport meta, 2x pixels) so responsive CSS and touch rules see what a phone sees.
export async function openSession({ viewport = { width: 1280, height: 800 }, mobile = false, headed = false, slowMo = 0, storageState = null, record = false, runDir, attach = null, bus = null, meter = null } = {}) {
  const state = resolveStorageState(storageState); // fail before launching anything: a missing login file must not leak a browser
  const h = meter?.start('launch');
  const browser = await launchBrowser({ headless: !headed, slowMo, onNote: (message) => bus?.emit('note', { message }) });
  meter?.end(h);
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    ...state,
    ...(record ? { recordVideo: { dir: path.join(runDir, 'video'), size: viewport } } : {}),
  });
  const page = await context.newPage();
  const presenter = (await attach?.({ browser, context, page, bus })) || null;
  const nop = async () => {};
  return {
    browser, context, page,
    hide: presenter?.hide?.bind(presenter) || nop,
    show: presenter?.show?.bind(presenter) || nop,
    // Run fn with the overlay hidden: measurements and report screenshots must see the page exactly as the app rendered it.
    async quiet(fn) { await this.hide(); try { return await fn(); } finally { await this.show(); } },
    async close() {
      const video = record ? page.video() : null;
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      const file = video ? await video.path().catch(() => null) : null;
      return { video: file && fs.existsSync(file) ? file : null };
    },
  };
}
