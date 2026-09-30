// The design contract: built-in packs, a project's design.md, tokens files, and every way a contract can be wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers/cli.mjs';
import { resolveContract, parseDesignMd, contractFromTokens, toSelector, ContractError } from '../../src/engine/contract.mjs';
import { loadTokens } from '../../src/engine/design-checks.mjs';
import { P } from '../../src/core/paths.mjs';

delete process.env.MOLE_DESIGN;
const project = (files) => { const d = tmpDir('mole-design-'); for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), text); } return d; };
const md = (block, prose = 'Calm, dense data screens.') => `# Acme Bank\n\n${prose}\n\n\`\`\`mole\n${block}\n\`\`\`\n`;

test('no design.md: modern-web best practice only (never someone else\'s brand), and the run says so', () => {
  const c = resolveContract({ cwd: project({}) });
  assert.equal(c.name, 'Modern web (built-in default)');
  assert.equal(c.fonts, null); assert.equal(c.colors, null); assert.equal(c.radii, null); assert.equal(c.buttons.heights, null);
  assert.equal(c.targets, 24); assert.equal(c.type.bodyMin, 14); assert.equal(c.inputZoom, false);
  assert.deepEqual(c.sources.map((s) => s.kind + ':' + s.name), ['pack:modern-web', 'default:built-in default']);
  assert.match(c.notes[0], /no DESIGN\.md found/);
});

test('a project folder handed over by the Claude Code plugin (MOLE_PROJECT_DIR) is where the design is looked for', () => {
  const d = project({ '.mole/design.md': md('extends: netos') });
  process.env.MOLE_PROJECT_DIR = d;
  try { assert.deepEqual(resolveContract().fonts, ['Inter', 'Montserrat', 'JetBrains Mono']); } finally { delete process.env.MOLE_PROJECT_DIR; }
});

test('a project design.md is found in the working directory and overrides its packs', () => {
  const d = project({ 'DESIGN.md': md(`extends: modern-web
fonts: [Georgia]
colors: { primary: "#0a7", ink: "#111111" }
type:
  scale: [12, 14, 18]
  body-min: { desktop: 15, mobile: 17 }
targets: { desktop: 32 }
radius: [0, 6]
rules: { line-length: off, contrast: high }
ignore: [".ant-*", "#legacy"]`) });
  const c = resolveContract({ cwd: d });
  assert.equal(c.name, 'Acme Bank'); assert.equal(c.prose, '# Acme Bank\n\nCalm, dense data screens.');
  assert.deepEqual(c.fonts, ['Georgia']); assert.deepEqual(c.colors, ['#0a7', '#111111']);
  assert.deepEqual(c.type.scale, [12, 14, 18]); assert.equal(c.type.bodyMin, 15); assert.equal(c.type.lineHeightMin, 1.4, 'inherited from modern-web');
  assert.equal(c.targets, 32); assert.deepEqual(c.radii, [0, 6]); assert.equal(c.buttons.heights, null, 'no NetOS buttons: they were not extended');
  assert.deepEqual(c.rules, { 'line-length': 'off', contrast: 'high' });
  assert.deepEqual(c.ignore, ['[class^="ant-"],[class*=" ant-"]', '#legacy']);
  assert.deepEqual(c.notes, []);
  const m = resolveContract({ cwd: d, platform: 'mobile' });
  assert.equal(m.type.bodyMin, 17); assert.equal(m.targets, 44, 'overriding desktop keeps the pack\'s mobile value'); assert.equal(m.inputZoom, true);
  assert.notEqual(m.hash, c.hash);
  assert.equal(resolveContract({ cwd: d }).hash, c.hash, 'same contract, same hash');
});

test('the design can name its platform, a tokens file, and extend netos; an explicit path wins over discovery', () => {
  const d = project({ 'design.md': md('platform: mobile\nextends: netos'), 'ui/brand.md': md('extends: modern-web\ntokens: ./tok.json\nfonts: [Roboto]'), 'ui/tok.json': JSON.stringify({ netos: { allowedFonts: ['Lato'], radiiPx: [0, 4] } }) });
  const found = resolveContract({ cwd: d });
  assert.equal(found.platform, 'mobile'); assert.deepEqual(found.fonts, ['Inter', 'Montserrat', 'JetBrains Mono']);
  const explicit = resolveContract({ cwd: d, design: 'ui/brand.md', platform: 'desktop' });
  assert.deepEqual(explicit.fonts, ['Roboto'], 'own keys beat the tokens file'); assert.deepEqual(explicit.radii, [0, 4]);
  assert.ok(explicit.sources.some((s) => s.kind === 'tokens' && s.path.endsWith('tok.json')));
  process.env.MOLE_DESIGN = 'ui/brand.md';
  try { assert.deepEqual(resolveContract({ cwd: d }).fonts, ['Roboto'], 'MOLE_DESIGN points at a design'); } finally { delete process.env.MOLE_DESIGN; }
});

test('a design.md without a mole block gets the modern-web defaults and a note', () => {
  const c = resolveContract({ cwd: project({ 'DESIGN.md': '# Loose notes\n\nWe like calm colours.\n' }) });
  assert.equal(c.fonts, null); assert.equal(c.targets, 24);
  assert.match(c.notes[0], /no ```mole block/);
});

test('every broken contract is a clear ContractError, never a silent default', () => {
  const bad = (block, re) => assert.throws(() => resolveContract({ cwd: project({ 'DESIGN.md': md(block) }) }), (e) => e instanceof ContractError && re.test(e.message));
  bad('extends: material-9', /unknown pack "material-9".*modern-web/);
  bad('rules: { contrast: loud }', /rules\.contrast must be one of off, low, medium, high/);
  bad('colors: [teal]', /colors must be #rgb or #rrggbb/);
  bad('type: { min: small }', /type\.min must be a number/);
  bad('platform: tablet', /platform must be one of desktop, mobile/);
  bad('tokens: ./missing.json', /tokens file not found/);
  bad('fonts: [Inter\n', /line 1: unclosed \[/);
  assert.throws(() => parseDesignMd('```mole\na: 1\n```\n```mole\nb: 2\n```\n'), /more than one/);
  assert.throws(() => resolveContract({ cwd: project({}), design: 'nope.md' }), /design file not found/);
});

test('legacy tokens.json callers keep exactly the original design-system rules and none of the practice pack', () => {
  const c = contractFromTokens(loadTokens(path.join(P.config, 'tokens.json')));
  assert.equal(c.targets, null); assert.deepEqual(c.type, { scale: null, min: null, bodyMin: null, lineHeightMin: null, maxLineChars: null, maxSizes: null });
  assert.equal(c.buttons.heights.length, 7); assert.equal(c.contrast.normal, 4.5);
});

test('ignore patterns: class prefixes expand, plain selectors pass through', () => {
  assert.equal(toSelector('.ant-*'), '[class^="ant-"],[class*=" ant-"]');
  assert.equal(toSelector('div.legacy > span'), 'div.legacy > span');
});
