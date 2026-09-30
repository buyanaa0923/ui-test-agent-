import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, styleOutliers } from '../../src/engine/fingerprint.mjs';

// collect()-shaped elements, only the fields the fingerprint reads
const look = (o = {}) => ({ bgAlpha: 1, bgLight: 1, border: 4, shadow: false, gradient: false, centered: false, tracking: 0, viewportShare: 0.3, ...o });
const card = (radius, o = {}) => ({ tag: 'div', rect: { w: 300, h: 120 }, radii: [radius, radius, radius, radius], look: look(o) });
const button = (radius, o = {}) => ({ tag: 'button', isButton: true, rect: { w: 120, h: 40 }, radii: [radius, radius, radius, radius], look: look({ bgLight: 0.2, ...o }) });
const text = (t, o = {}) => ({ tag: o.tag || 'p', rect: { w: 600, h: 24 }, hasText: true, text: t, fontSize: o.size || 16, fontWeight: o.weight || 400, fontFamily: o.font || 'Inter, sans-serif', look: look({ bgAlpha: 0, border: 0, centered: !!o.centered }) });
const pageOf = ({ radius = 0, shadow = false, emoji = false, weight = 700, font } = {}) => [
  card(radius, { shadow }), card(radius, { shadow }), button(radius),
  text(`${emoji ? '🚀 ' : ''}Loan applications`, { tag: 'h1', size: 32, weight, font }),
  ...Array.from({ length: 6 }, () => text('Every account is reviewed within two working days and the result is sent by email.', { font })),
];
const site = (odd) => ['/', '/a', '/b', '/c', '/d'].map((path, i) => ({ path, fp: fingerprint(i === 3 && odd ? pageOf(odd) : pageOf()) }));

test('fingerprint: what a page is made of, and nothing when there is too little to say', () => {
  const fp = fingerprint(pageOf({ radius: 20, shadow: true, emoji: true }));
  assert.equal(fp.containerRounded, 1); assert.equal(fp.containerRadius, 20); assert.equal(fp.shadow, 1); assert.equal(fp.emoji, 0.333); assert.equal(fp.headingWeight, 700);
  assert.equal(fingerprint([text('hi')]).emoji, null, 'one line of text says nothing about emoji use');
  assert.equal(fingerprint([text('hi')]).containerRounded, null, 'no cards: no card style');
});

test('styleOutliers: a consistent site has no outliers; one drifted page is found, with the numbers', () => {
  assert.deepEqual(styleOutliers(site(null)).outliers, []);
  const r = styleOutliers(site({ radius: 20, shadow: true }));
  assert.deepEqual(r.outliers.map((o) => o.path), ['/c'], 'the drifted page, and only it');
  assert.ok(r.outliers[0].differences.some((d) => d.text === 'drop shadows on cards and panels: 100% here, 0% on the other pages'));
  assert.ok(r.outliers[0].families.includes('corners') && r.outliers[0].families.includes('depth'));
});

test('styleOutliers: one weak signal alone (centred text, as a landing page has) never flags a page', () => {
  const pages = site(null);
  const centred = pageOf().map((e) => (e.hasText ? { ...e, look: { ...e.look, centered: true } } : e));
  pages[2] = { path: '/b', fp: fingerprint(centred) };
  assert.deepEqual(styleOutliers(pages).outliers, []);
});

test('styleOutliers: needs enough pages to compare, and says so', () => {
  const r = styleOutliers(site({ radius: 20 }).slice(0, 3));
  assert.equal(r.checked, false); assert.match(r.reason, /at least 4 pages/);
});

test('styleOutliers: the main typeface comes from the other pages, so a page set in another face stands out', () => {
  const r = styleOutliers(site({ font: 'JetBrains Mono, monospace' }));
  assert.deepEqual(r.outliers.map((o) => o.path), ['/c']);
  assert.ok(r.outliers[0].differences.some((d) => /text in inter: 0% here/.test(d.text)));
});
