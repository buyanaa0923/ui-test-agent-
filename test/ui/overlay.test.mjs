import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture } from '../helpers/cli.mjs';
import { openSession } from '../../src/engine/session.mjs';
import { attachOverlay } from '../../src/ui/overlay/index.mjs';
import { EventBus } from '../../src/core/events.mjs';
import { collect, loadTokens, runRules } from '../../src/engine/design-checks.mjs';
import { P } from '../../src/core/paths.mjs';

const tokens = loadTokens(path.join(P.config, 'tokens.json'));
const measure = async (s) => runRules(await s.quiet(() => collect(s.page)), tokens, { mode: 'light' }).map((f) => `${f.key}|${f.detail}`);

test('the overlay never changes what the design checks measure (the invariant that makes it safe to demo)', async () => {
  const plain = await openSession({});
  await plain.page.goto(fixture('sample.html'));
  const baseline = await measure(plain); await plain.close();

  const bus = new EventBus();
  const shown = await openSession({ attach: attachOverlay, bus });
  await shown.page.goto(fixture('sample.html'));
  assert.equal(await shown.page.evaluate(() => !!window.__mole), true, 'overlay is injected');
  await shown.page.evaluate(() => window.__mole.hud({ sub: 'digging', elements: 25, nuggets: 3, usd: '$0', progress: 0.5, feed: [{ kind: 'jev', text: 'Jev: real 91%' }] }));
  await shown.page.evaluate(() => window.__mole.sweep([{ x: 24, y: 60, w: 90, h: 30, rule: 'contrast' }, { x: 24, y: 100, w: 90, h: 30, rule: null }], 200));
  const withOverlay = await measure(shown);
  await shown.close();
  assert.deepEqual(withOverlay, baseline);
  assert.ok(baseline.length > 5, 'the comparison is over real findings');
});

test('the overlay lives outside <body> in a closed shadow root and cannot catch clicks', async () => {
  const s = await openSession({ attach: attachOverlay, bus: new EventBus() });
  await s.page.goto(fixture('clean.html'));
  const info = await s.page.evaluate(() => { const h = document.querySelector('mole-overlay'); return { inBody: document.body.contains(h), parent: h.parentElement.tagName, shadow: h.shadowRoot, pe: getComputedStyle(h).pointerEvents }; });
  assert.equal(info.inBody, false); assert.equal(info.parent, 'HTML'); assert.equal(info.shadow, null, 'closed shadow root'); assert.equal(info.pe, 'none');
  await s.page.evaluate(() => window.__mole.target({ x: 24, y: 120, width: 90, height: 36 }, '#1 Continue'));
  await s.page.locator('#go').click({ timeout: 3000 }); // would time out if the overlay intercepted pointer events
  assert.equal(await s.page.locator('#status').textContent(), 'Saved');
  await s.close();
});

test('hide() removes it from view for screenshots and show() brings it back', async () => {
  const s = await openSession({ attach: attachOverlay, bus: new EventBus() });
  await s.page.goto(fixture('clean.html'));
  const shownDisplay = () => s.page.evaluate(() => getComputedStyle(document.querySelector('mole-overlay')).display);
  assert.notEqual(await shownDisplay(), 'none');
  await s.hide(); assert.equal(await shownDisplay(), 'none');
  await s.show(); assert.notEqual(await shownDisplay(), 'none');
  await s.quiet(async () => assert.equal(await shownDisplay(), 'none', 'quiet() hides for the duration'));
  assert.notEqual(await shownDisplay(), 'none');
  await s.close();
});

test('the overlay survives navigation and re-applies the HUD (the tunnel reloads the page every step)', async () => {
  const bus = new EventBus();
  const s = await openSession({ attach: attachOverlay, bus });
  bus.emit('run.start', { command: 'tunnel', url: 'u', max: 5, picker: 'heuristic', triage: 'none' });
  bus.emit('page.loaded', { elements: 9 });
  await s.page.goto(fixture('clean.html'));
  await s.page.waitForFunction(() => !!window.__mole);
  await s.page.goto(fixture('sample.html'));
  await s.page.waitForFunction(() => !!window.__mole);
  await s.page.waitForTimeout(150);
  const alive = await s.page.evaluate(() => !!document.querySelector('mole-overlay'));
  assert.equal(alive, true);
  await s.close();
});
