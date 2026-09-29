import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetHtml, buildTemplateCsv } from '../src/review-sheet.mjs';
import { parseCsv } from '../src/agreement.mjs';

const rec = (id, over = {}) => ({ id, why: 'contrast', positive: null, label: '',
  finding: { rule: 'contrast', element: 'span.x', text: 'Save <script>alert(1)</script>', detail: 'contrast 4.43:1 (light mode)', mode: 'light', severity: 'medium', ctx: {} },
  source: { kind: 'design', pages: ['http://localhost:5200/a'], modes: ['light'], detailByMode: { light: 'contrast 4.43:1' }, rect: { x: 10, y: 20, w: 50, h: 12 }, runs: ['r'], shots: {} }, ...over });

test('sheet lists every record with three choices, escapes page text, and carries no model verdict', () => {
  const html = buildSheetHtml([rec('real-aaaaaaaa'), rec('real-bbbbbbbb')], { real_aaaaaaaa: null });
  assert.match(html, /real-aaaaaaaa/); assert.match(html, /real-bbbbbbbb/);
  assert.equal((html.match(/value="real"/g) || []).length, 2);
  assert.equal((html.match(/value="false_positive"/g) || []).length, 2);
  assert.equal((html.match(/value="unsure"/g) || []).length, 2);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /verdict|jev says|claude says/i);
});
test('template csv has one row per record, an empty label column, and round-trips', () => {
  const rows = parseCsv(buildTemplateCsv([rec('real-aaaaaaaa'), rec('real-bbbbbbbb')]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['real-aaaaaaaa', 'real-bbbbbbbb']);
  assert.ok(rows.every((r) => r.label === '' && r.notes === ''));
  assert.ok(rows[0].text.includes('<script>'), 'csv keeps the raw text; only html is escaped');
});
