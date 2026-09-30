// Mapping a finding to the file:line that wrote the element: exact from dev-build metadata, else a scored source search
// that says how sure it is, lists alternatives when two places look alike, and says nothing rather than guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture, tmpDir } from '../helpers/cli.mjs';
import { ROOT } from '../../src/core/paths.mjs';

process.env.MOLE_RUNS_DIR = tmpDir('mole-runs-'); process.env.UTA_NO_DOTENV = '1'; delete process.env.MOLE_DESIGN; delete process.env.MOLE_SRC_ROOT;
const { createLocator, projectRoot } = await import('../../src/engine/locate.mjs');
const { dig } = await import('../../src/engine/dig.mjs');

const app = path.join(ROOT, 'test-pages', 'locate');
const L = () => createLocator({ root: app });
const at = (w) => (w ? `${w.file}:${w.line}` : null);

test('runtime metadata is exact: React _debugSource (dev-server path), inspector attributes, bundler paths', () => {
  const l = L();
  const react = l.locate({ src: { file: '/src/components/Card.tsx', line: 7, column: 7, via: 'react', component: 'Card' } });
  assert.deepEqual(react, { file: 'src/components/Card.tsx', line: 7, column: 7, confidence: 'exact', via: 'react', component: 'Card' });
  assert.equal(at(l.locate({ src: { file: path.join(app, 'src/components/Header.tsx'), line: 5, via: 'code-inspector' } })), 'src/components/Header.tsx:5', 'absolute paths too');
  assert.equal(at(l.locate({ src: { file: 'webpack://./src/components/Drawer.tsx?abc', line: 4, via: 'react' } })), 'src/components/Drawer.tsx:4', 'bundler prefixes and queries are stripped');
});

test('a reported file that does not exist here is not trusted: the search decides instead', () => {
  const w = L().locate({ src: { file: '/elsewhere/Gone.tsx', line: 3, via: 'react' }, tag: 'input', placeholder: 'Email address', classes: ['field-input'], context: ['form.login-form'] });
  assert.equal(at(w), 'src/components/LoginForm.tsx:8'); assert.equal(w.via, 'search');
});

test('search: text + classes, i18n keys, placeholders; test files lose to the component', () => {
  const l = L();
  const submit = l.locate({ tag: 'button', ownText: 'Sign in to your account', classes: ['btn', 'btn-primary', 'login-submit'], src: { file: null, line: null, via: 'react', component: 'LoginForm' } });
  assert.equal(submit.file, 'src/components/LoginForm.tsx', 'not LoginForm.test.tsx, which has the same text');
  assert.ok(submit.line >= 11 && submit.line <= 13); assert.equal(submit.confidence, 'high'); assert.equal(submit.component, 'LoginForm');
  const textOnly = l.locate({ tag: 'button', ownText: 'Sign in to your account' });
  assert.equal(textOnly.file, 'src/components/LoginForm.tsx', 'text alone: the test file is penalised');
  const forgot = l.locate({ tag: 'a', ownText: 'Forgot your password?', classes: ['login-forgot'] });
  assert.equal(at(forgot), 'src/components/LoginForm.tsx:15', "the text lives in en.json; the code uses t('login.forgot')");
  assert.ok(forgot.why.includes('i18n key'));
});

test('two identical buttons: without context Mole says it is unsure and lists both; the surroundings settle it', () => {
  const l = L();
  const bare = l.locate({ tag: 'button', ariaLabel: 'Close', classes: ['icon-btn'] });
  assert.notEqual(bare.confidence, 'high');
  assert.deepEqual([at(bare), ...bare.alternatives].sort(), ['src/components/Drawer.tsx:4', 'src/components/Header.tsx:5']);
  const inHeader = l.locate({ tag: 'button', ariaLabel: 'Close', classes: ['icon-btn'], context: ['header.app-header'] });
  assert.equal(at(inHeader), 'src/components/Header.tsx:5'); assert.equal(inHeader.alternatives, undefined);
});

test('no evidence, weak evidence or no project: no location rather than a guess', () => {
  const l = L();
  assert.equal(l.locate({ tag: 'div', ownText: 'Nothing like this exists anywhere', classes: ['flex', 'p-4'] }), null);
  assert.equal(l.locate({ tag: 'span', classes: ['icon-btn'] }), null, 'a class alone only supports, it never names a place');
  assert.equal(l.locate(null), null);
  const home = createLocator({ root: os.homedir() });
  assert.equal(home.locate({ id: 'x', tag: 'div' }), null); assert.match(home.notes[0], /not a project folder/);
  assert.equal(projectRoot(path.join(app, 'src', 'components')), ROOT, 'nearest folder with a package.json');
});

test('dig end to end: every finding on the rendered page points at the component that wrote it', async () => {
  const r = await dig({ url: fixture('locate-page.html'), name: 't-locate', modes: ['light'], root: app });
  const where = Object.fromEntries(r.findings.map((f) => [f.element, at(f.where)]));
  assert.equal(where['button.icon-btn'], 'src/components/Header.tsx:5');
  assert.equal(where['input.field-input'], 'src/components/LoginForm.tsx:8');
  assert.equal(where['a.login-forgot'], 'src/components/LoginForm.tsx:15');
  assert.equal(where['h3.card-title'], 'src/components/Card.tsx:6', 'data-mole-src');
  assert.equal(where['p.card-body'], 'src/components/Card.tsx:7', 'React fiber _debugSource');
  assert.ok(r.findings.every((f) => !('hint' in f)), 'raw hints stay out of the report');
  const off = await dig({ url: fixture('locate-page.html'), name: 't-locate-off', modes: ['light'], locate: false });
  assert.ok(off.findings.every((f) => !f.where));
});

test('dig without a root searches the working directory (here: this repository and its fixtures)', async () => {
  const r = await dig({ url: fixture('sample.html'), name: 't-locate-cwd', modes: ['light'] });
  const f = r.findings.find((x) => x.key === 'hint|contrast');
  const line = fs.readFileSync(path.join(ROOT, 'test-pages', 'sample.html'), 'utf8').split(/\r?\n/).findIndex((l) => l.includes('id="hint"')) + 1;
  assert.equal(at(f.where), `test-pages/sample.html:${line}`); assert.equal(f.where.confidence, 'high');
});

// ---- page-aware: a Next.js App Router project (test-pages/locate-next) ------------------------------------------------
const next = path.join(ROOT, 'test-pages', 'locate-next');
const { nextRouteFiles, reachableFiles, parseJsonc } = await import('../../src/engine/locate.mjs');
const relN = (s) => [...s].map((f) => path.relative(next, f).split(path.sep).join('/')).sort();

test('tsconfig with comments, trailing commas and "/*" inside strings is read correctly', () => {
  const ts = parseJsonc(fs.readFileSync(path.join(next, 'tsconfig.json'), 'utf8'));
  assert.deepEqual(ts.compilerOptions.paths, { '@/*': ['./*'] }); assert.deepEqual(ts.include, ['**/*.ts', '**/*.tsx']);
});

test('Next.js: a URL maps to its page and layouts (dynamic segments, route groups), then to what they import', () => {
  assert.deepEqual(relN(nextRouteFiles(next, 'http://localhost:3000/en')), ['app/[locale]/page.tsx', 'app/layout.tsx']);
  assert.deepEqual(relN(nextRouteFiles(next, 'http://localhost:3000/about')), ['app/(marketing)/about/page.tsx', 'app/layout.tsx']);
  assert.equal(nextRouteFiles(next, 'http://localhost:3000/nope/deeper'), null);
  assert.equal(nextRouteFiles(next, fixture('sample.html')), null, 'not a web URL: not page-aware');
  const home = relN(reachableFiles(next, nextRouteFiles(next, 'http://localhost:3000/en')));
  assert.ok(home.includes('components/Hero.tsx') && home.includes('components/Nav.tsx'), '@/ aliases resolved');
  assert.ok(!home.includes('components/Promo.tsx'), 'a commented-out import renders nothing');
});

test('page-aware: identical markup in two components resolves to the one this URL renders; excluded and legacy code never wins', () => {
  const hint = { tag: 'span', classes: ['text-[11px]', 'font-medium', 'uppercase', 'tracking-widest'], ownText: 'Welcome' };
  const homeLocator = createLocator({ root: next, url: 'http://localhost:3000/en' });
  const onHome = homeLocator.locate(hint);
  assert.equal(at(onHome), 'components/Hero.tsx:4');
  assert.match(homeLocator.notes.join(' '), /page-aware locations: 4 files render \/en/, 'the run says it knew which files render the page');
  const onAbout = createLocator({ root: next, url: 'http://localhost:3000/about' }).locate(hint);
  assert.equal(at(onAbout), 'components/Promo.tsx:4');
  const blind = createLocator({ root: next }).locate(hint);
  assert.ok(!blind.file.startsWith('old.legacy/'), 'tsconfig exclude is respected even though that file has the exact text');
});
