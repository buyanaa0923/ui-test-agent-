// `watch: true` from an MCP client (Claude Code) must put the live overlay on the developer's screen: the real overlay is
// attached to the page and the run is paced. MOLE_HEADLESS keeps the window hidden on test machines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, tmpDir } from '../helpers/cli.mjs';

process.env.MOLE_RUNS_DIR = tmpDir('mole-runs-'); process.env.UTA_NO_DOTENV = '1'; process.env.MOLE_HEADLESS = '1';
process.env.TYPESAFE_API_KEY = ''; process.env.ANTHROPIC_API_KEY = ''; delete process.env.MOLE_WATCH;
const { byName } = await import('../../src/mcp/tools.mjs');
const { attachOverlay } = await import('../../src/ui/overlay/index.mjs');

// A loader like the one the CLI injects, wrapped to observe the page the overlay lands in.
function spyOverlay() {
  const seen = { attached: 0, overlayInPage: [] };
  const load = async () => async (args) => {
    seen.attached++;
    const presenter = await attachOverlay(args);
    args.bus.on((e) => { if (e.type === 'mode.done') seen.overlayInPage.push(args.page.evaluate(() => !!window.__mole).catch(() => false)); });
    return presenter;
  };
  return { seen, load };
}

test('watch: true attaches the live overlay and paces the run; default stays headless and unpaced', async () => {
  const dig = byName.get('mole_dig');
  const w = spyOverlay();
  const t0 = Date.now();
  const watched = await dig.run({ url: fixture('clean.html'), model: 'none', modes: ['light'], watch: true }, { overlay: w.load });
  const watchedMs = Date.now() - t0;
  assert.equal(watched.data.status, 'pass');
  assert.equal(w.seen.attached, 1, 'the overlay was attached');
  assert.deepEqual(await Promise.all(w.seen.overlayInPage), [true], 'the overlay is running inside the page');

  const quiet = spyOverlay();
  const t1 = Date.now();
  await dig.run({ url: fixture('clean.html'), model: 'none', modes: ['light'] }, { overlay: quiet.load });
  assert.equal(quiet.seen.attached, 0, 'no watch, no overlay');
  assert.ok(watchedMs - (Date.now() - t1) > 1500, 'a watched run lingers so a person can follow it');

  process.env.MOLE_WATCH = '1';
  try {
    const env = spyOverlay();
    await dig.run({ url: fixture('clean.html'), model: 'none', modes: ['light'] }, { overlay: env.load });
    assert.equal(env.seen.attached, 1, 'MOLE_WATCH=1 makes watching the default');
    const off = spyOverlay();
    await dig.run({ url: fixture('clean.html'), model: 'none', modes: ['light'], watch: false }, { overlay: off.load });
    assert.equal(off.seen.attached, 0, 'an explicit watch: false wins');
  } finally { delete process.env.MOLE_WATCH; }
});
