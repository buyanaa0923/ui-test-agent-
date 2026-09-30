import test from 'node:test';
import assert from 'node:assert/strict';
import { findingKey, groupFindings, uniqueCounted, dedupeForJudging } from '../../src/core/findings.mjs';

const F = (o) => ({ key: `${o.element}|${o.rule}${o.mode === 'dark' ? '@dark' : ''}`, severity: 'medium', mode: 'light', ...o });
const light = F({ rule: 'control-unlabeled', element: 'select#a', detail: 'no label' });
const dark = F({ rule: 'control-unlabeled', element: 'select#a', detail: 'no label', mode: 'dark' });
const cLight = F({ rule: 'contrast', element: 'p#x', detail: 'contrast 2.56:1, needs 4.5:1 (light mode)' });
const cDark = F({ rule: 'contrast', element: 'p#x', detail: 'contrast 3.75:1, needs 4.5:1 (dark mode)', mode: 'dark' });
const cSame = F({ rule: 'contrast', element: 'p#y', detail: 'contrast 2.00:1, needs 4.5:1 (light mode)' });
const cSameDark = F({ rule: 'contrast', element: 'p#y', detail: 'contrast 2.00:1, needs 4.5:1 (dark mode)', mode: 'dark' });

test('same rule, element and measurement in light and dark is one defect', () => {
  assert.equal(findingKey(cSame), findingKey(cSameDark));
  assert.equal(groupFindings([light, dark]).length, 1);
  assert.deepEqual(groupFindings([light, dark])[0].modes, ['light', 'dark']);
});

test('a different measurement per mode stays two defects (contrast really differs)', () => {
  assert.notEqual(findingKey(cLight), findingKey(cDark));
  assert.equal(groupFindings([cLight, cDark]).length, 2);
});

test('a group is dismissed only if every member was', () => {
  const a = { ...light, verdict: 'false_positive', by: 'jev' }, b = { ...dark, verdict: 'real', by: 'claude' };
  assert.equal(uniqueCounted([a, b]).length, 1);
  assert.equal(uniqueCounted([a, { ...dark, verdict: 'false_positive', by: 'jev' }]).length, 0);
});

test('dedupeForJudging sends each distinct defect once and copies the verdict onto its twin', () => {
  const all = [light, cLight, cDark, dark, cSame, cSameDark];
  const { unique, spread } = dedupeForJudging(all);
  assert.equal(unique.length, 4, 'light+dark twins collapse, differing contrast stays');
  const judged = unique.map((f) => ({ ...f, verdict: f.rule === 'contrast' && f.element === 'p#x' && f.mode === 'light' ? 'false_positive' : 'real', by: 'jev', confidence: 0.9, p: 0.9 }));
  const out = spread(judged);
  assert.equal(out.length, all.length, 'nothing is dropped');
  assert.deepEqual(out.map((f) => f.key), all.map((f) => f.key), 'order and identity preserved');
  const twin = out.find((f) => f.key === dark.key);
  assert.equal(twin.verdict, 'real'); assert.equal(twin.mode, 'dark'); assert.equal(twin.detail, 'no label');
  assert.equal(out.find((f) => f.key === cLight.key).verdict, 'false_positive');
  assert.equal(out.find((f) => f.key === cDark.key).verdict, 'real', 'the dark contrast was judged on its own measurement');
});

test('an unjudged representative leaves its twin unjudged too, never silently passed', () => {
  const { unique, spread } = dedupeForJudging([light, dark]);
  const out = spread(unique.map((f) => ({ ...f, verdict: 'unjudged', by: 'none' })));
  assert.ok(out.every((f) => f.verdict === 'unjudged'));
});
