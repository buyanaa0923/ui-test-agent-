// The modern-web pack and design.md contracts, end to end in a real browser, plus the rules that need no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, tmpDir } from '../helpers/cli.mjs';

const runs = tmpDir('mole-runs-'); process.env.MOLE_RUNS_DIR = runs; process.env.UTA_NO_DOTENV = '1'; delete process.env.MOLE_DESIGN;
const { dig } = await import('../../src/engine/dig.mjs');
const { runRules } = await import('../../src/engine/design-checks.mjs');
const { resolveContract, normalize, ContractError } = await import('../../src/engine/contract.mjs');
const expected = JSON.parse(fs.readFileSync(new URL('../../test-pages/modern.expected.json', import.meta.url), 'utf8'));

const keys = (r) => r.findings.map((f) => f.key).sort();
const designFile = (block) => { const f = path.join(tmpDir('mole-design-'), 'design.md'); fs.writeFileSync(f, `# Test design\n\n\`\`\`mole\n${block}\n\`\`\`\n`); return f; };

test('desktop: exactly the seeded best-practice defects; spaced and inline targets are exempt (WCAG 2.5.8)', async () => {
  const r = await dig({ url: fixture('modern.html'), name: 't-modern', modes: ['light'] });
  assert.deepEqual(keys(r), [...expected.desktop].sort());
  for (const k of expected.neverDesktop) assert.ok(!keys(r).includes(k), `${k} must not fire on desktop`);
  const t = r.findings.find((f) => f.rule === 'target-size');
  assert.equal(t.tier, 'standard'); assert.equal(t.ref, 'WCAG 2.2 SC 2.5.8'); assert.match(t.fix, /24x24/);
  assert.equal(r.contract.platform, 'desktop');
  const rep = JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8'));
  assert.equal(rep.contract.name, 'Mole test pages (NetOS)', 'found in .mole/design.md of this repository'); assert.ok(rep.stamp.contractHash);
});

test('mobile: phone viewport, 44px targets, 16px body text and the iOS input-zoom rule', async () => {
  const r = await dig({ url: fixture('modern.html'), name: 't-modern-m', modes: ['light'], platform: 'mobile' });
  for (const k of [...expected.desktop, ...expected.mobileAlso]) assert.ok(keys(r).includes(k), `mobile should report ${k}`);
  assert.equal(r.findings.find((f) => f.key === 'ok|target-size').tier, 'practice');
  const rep = JSON.parse(fs.readFileSync(path.join(r.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(rep.viewport, { width: 390, height: 844, mobile: true }, 'measured in a phone viewport');
  assert.equal(fs.readFileSync(path.join(r.runDir, 'light.png')).readUInt32BE(16) % 2, 0, 'screenshot at 2x pixels');
});

test('a project design.md changes what is checked: rules off, severities, ignored areas, type scale', async () => {
  const design = designFile(`extends: modern-web
type: { scale: [14, 24] }
rules: { line-length: off, text-too-small: high }
ignore: ["#tight"]`);
  const r = await dig({ url: fixture('modern.html'), name: 't-design', modes: ['light'], design });
  const k = keys(r);
  assert.ok(!k.includes('wide|line-length'), 'switched off');
  assert.ok(!k.some((x) => x.startsWith('tight|')), 'ignored element is not checked');
  assert.equal(r.findings.find((f) => f.key === 'fine-print|text-too-small').severity, 'high');
  assert.ok(k.includes('small-body|type-scale') && k.includes('fine-print|type-scale'), '13px and 10px are off the 14/24 scale');
  assert.ok(!k.some((x) => /font-family|button-height|radius-scale/.test(x)), 'no NetOS rules: this design does not extend netos');
  assert.equal(r.contract.name, 'Test design');
});

test('a design.md with a broken ignore selector is a ContractError, not a scan', async () => {
  await assert.rejects(dig({ url: fixture('modern.html'), name: 't-bad', modes: ['light'], design: designFile('ignore: ["div[["]') }), (e) => e instanceof ContractError && /not a valid CSS selector/.test(e.message));
});

// ---- rules that need no browser -------------------------------------------------------------------------------------
const el = (o = {}) => ({ label: o.id ? `p#${o.id}` : 'p', id: null, tag: 'p', text: 't', hasText: true, fontSize: 14, fontFamily: 'Inter', fontWeight: 400, radii: [0, 0, 0, 0], inlineStyle: '', display: 'block', clientW: 0, scrollW: 0, color: null, bg: null, ...o });
const contract = (raw) => normalize(raw);

test('font-size sprawl is a page-level finding; spacing grid and type scale only apply when the design names them', () => {
  const page = [el({ tag: 'body', label: 'body', hasText: false }), ...[10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 30, 36].map((s, i) => el({ id: `s${i}`, fontSize: s }))];
  const sprawl = runRules(page, contract({ type: { 'max-sizes': 10 } }));
  assert.deepEqual(sprawl.map((f) => f.key), ['body|font-size-sprawl']); assert.match(sprawl[0].detail, /12 distinct text sizes/);
  assert.deepEqual(runRules(page, contract({})), [], 'nothing configured, nothing checked');
  const spaced = [el({ id: 'a', spacing: [8, 16, 8, 16, 0, 0] }), el({ id: 'b', spacing: [6, 16, 6, 16, 0, 1] })];
  assert.deepEqual(runRules(spaced, contract({ spacing: 4 })).map((f) => f.key), ['b|spacing-grid'], '6px is off a 4px grid; 1px borders are ignored');
  assert.deepEqual(runRules(spaced, contract({ spacing: 8 })).map((f) => f.key), ['b|spacing-grid']);
});

test('the practice pack never reaches legacy tokens callers (benchmark stays comparable)', () => {
  const tokens = JSON.parse(fs.readFileSync(new URL('../../config/tokens.json', import.meta.url), 'utf8'));
  const tiny = el({ id: 'x', fontSize: 9, isBody: true, blockLines: 4, textLen: 900, lineHeight: 9, isTarget: true, hitRect: { x: 0, y: 0, w: 8, h: 8 } });
  assert.deepEqual(runRules([tiny], tokens), []);
  assert.deepEqual(runRules([tiny], resolveContract({ cwd: tmpDir() })).map((f) => f.rule).sort(), ['line-height-tight', 'line-length', 'text-too-small']);
});

test('fonts renamed by bundlers are recognised: next/font, its fallback, variable fonts', async () => {
  const { fontName } = await import('../../src/engine/design-checks.mjs');
  assert.equal(fontName("__Inter_b4e6b6, __Inter_Fallback_b4e6b6"), 'Inter');
  assert.equal(fontName('__Inter_Fallback_b4e6b6'), 'Inter');
  assert.equal(fontName('"__JetBrains_Mono_3c557b", monospace'), 'JetBrains Mono');
  assert.equal(fontName("'Inter Variable', sans-serif"), 'Inter');
  assert.equal(fontName('Arial, sans-serif'), 'Arial');
  const c = normalize({ fonts: ['Inter', 'Montserrat'] });
  assert.deepEqual(runRules([el({ id: 'a', fontFamily: '__Inter_b4e6b6, __Inter_Fallback_b4e6b6' }), el({ id: 'b', fontFamily: '__Montserrat_79b90d' })], c), [], 'next/font names are the chosen fonts');
  assert.deepEqual(runRules([el({ id: 'c', fontFamily: 'Arial, sans-serif' })], c).map((f) => f.rule), ['font-family'], 'a real fallback is still caught');
});
