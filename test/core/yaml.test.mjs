import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../../src/core/yaml.mjs';

test('yaml subset: maps, nesting, flow and block lists, scalars', () => {
  const y = parseYaml(`
extends: modern-web       # a comment
platform: mobile
fonts: [Inter, "JetBrains Mono"]
type:
  scale: [12, 14, 16.5]
  body-min: { desktop: 14, mobile: 16 }
  flag: true
ignore:
  - ".ant-*"
  - "#legacy"
empty:
`);
  assert.deepEqual(y, {
    extends: 'modern-web', platform: 'mobile', fonts: ['Inter', 'JetBrains Mono'],
    type: { scale: [12, 14, 16.5], 'body-min': { desktop: 14, mobile: 16 }, flag: true },
    ignore: ['.ant-*', '#legacy'], empty: null,
  });
});

test('yaml subset: hex colours are values, not comments; "off" stays a string', () => {
  const y = parseYaml('colors: [#008779, #fff]   # brand\nprimary: #1c285e\nrules: { line-length: off }\nlist:\n- #e6f4f2\n');
  assert.deepEqual(y, { colors: ['#008779', '#fff'], primary: '#1c285e', rules: { 'line-length': 'off' }, list: ['#e6f4f2'] });
});

test('yaml subset: mistakes throw with a line number instead of half-reading', () => {
  assert.throws(() => parseYaml('a: 1\nnot a key\n'), /line 2/);
  assert.throws(() => parseYaml('a: [1, 2\n'), /line 1: unclosed \[/);
  assert.throws(() => parseYaml('a:\n    b: 1\n  c: 2\n'), /line 3: unexpected indentation/);
  assert.throws(() => parseYaml('a:\n\tb: 1\n'), /tabs/);
});

test('yaml subset: a key set twice is an error, not a silent overwrite', () => {
  assert.throws(() => parseYaml('fonts: [Inter]\ncolors: []\nfonts: [Montserrat]\n'), /line 3: "fonts" is set twice/);
});
