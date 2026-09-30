import test from 'node:test';
import assert from 'node:assert/strict';
import { cohenKappa, wilson, parseCsv, toCsv, mergeLabels } from '../../src/eval/agreement.mjs';

const pairs = (aa, ab, ba, bb) => [...Array(aa).fill(['real', 'real']), ...Array(ab).fill(['real', 'false_positive']), ...Array(ba).fill(['false_positive', 'real']), ...Array(bb).fill(['false_positive', 'false_positive'])];

test('kappa matches the textbook example (20/5/10/15 -> po 0.7, pe 0.5, kappa 0.4)', () => {
  const k = cohenKappa(pairs(20, 5, 10, 15));
  assert.equal(k.n, 50);
  assert.ok(Math.abs(k.observed - 0.7) < 1e-9);
  assert.ok(Math.abs(k.expected - 0.5) < 1e-9);
  assert.ok(Math.abs(k.kappa - 0.4) < 1e-9);
});
test('perfect agreement gives kappa 1; chance-level agreement gives ~0', () => {
  assert.equal(cohenKappa(pairs(10, 0, 0, 10)).kappa, 1);
  assert.ok(Math.abs(cohenKappa(pairs(5, 5, 5, 5)).kappa) < 1e-9);
});
test('kappa is undefined (null), not NaN or 1, when both labellers used a single label', () => {
  assert.equal(cohenKappa(pairs(8, 0, 0, 0)).kappa, null);
  assert.equal(cohenKappa([]).kappa, null);
});
test('wilson interval brackets the estimate, is wider for small n, and handles 0 and n', () => {
  const small = wilson(9, 10), large = wilson(90, 100);
  assert.ok(small.lo < 0.9 && small.hi > 0.9 && small.hi - small.lo > large.hi - large.lo);
  assert.equal(wilson(0, 0), null);
  assert.ok(wilson(10, 10).hi <= 1 && wilson(0, 10).lo >= 0);
});
test('csv round-trips commas, quotes and newlines', () => {
  const rows = [{ id: 'a', note: 'has, comma', x: 'say "hi"' }, { id: 'b', note: 'two\nlines', x: '' }];
  assert.deepEqual(parseCsv(toCsv(rows, ['id', 'note', 'x'])), rows);
});
test('parseCsv tolerates CRLF and a trailing blank line (spreadsheet exports)', () => {
  assert.deepEqual(parseCsv('id,label\r\na,real\r\nb,false_positive\r\n\r\n'), [{ id: 'a', label: 'real' }, { id: 'b', label: 'false_positive' }]);
});

const recs = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id, label: '' }));
test('mergeLabels: agreement is accepted, disagreement needs adjudication, unsure and unlabeled are reported not guessed', () => {
  const A = [{ id: 'r1', label: 'real' }, { id: 'r2', label: 'real' }, { id: 'r3', label: 'unsure' }, { id: 'r4', label: 'false_positive' }];
  const B = [{ id: 'r1', label: 'real' }, { id: 'r2', label: 'false_positive' }, { id: 'r3', label: 'real' }, { id: 'r4', label: 'false_positive' }];
  const m = mergeLabels(recs, A, B, []);
  assert.deepEqual(m.final, { r1: 'real', r4: 'false_positive' });
  assert.deepEqual(m.needsAdjudication.sort(), ['r2', 'r3']);
  assert.deepEqual(m.unlabeled, ['r5']);
  assert.equal(m.kappa.n, 3); // r1, r2, r4: both used real/false_positive; r3 has an 'unsure', so it is left out
});
test('mergeLabels: adjudication resolves a disagreement but never overrides an agreement', () => {
  const A = [{ id: 'r1', label: 'real' }, { id: 'r2', label: 'real' }];
  const B = [{ id: 'r1', label: 'real' }, { id: 'r2', label: 'false_positive' }];
  const m = mergeLabels(recs.slice(0, 2), A, B, [{ id: 'r1', label: 'false_positive' }, { id: 'r2', label: 'false_positive' }]);
  assert.equal(m.final.r1, 'real');
  assert.equal(m.final.r2, 'false_positive');
  assert.deepEqual(m.needsAdjudication, []);
});
test('mergeLabels rejects labels outside real / false_positive / unsure', () => {
  assert.throws(() => mergeLabels(recs.slice(0, 1), [{ id: 'r1', label: 'yes' }], [{ id: 'r1', label: 'real' }], []), /invalid label/i);
});
