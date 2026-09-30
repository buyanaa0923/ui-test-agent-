import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduce } from '../../src/ui/state.mjs';
import { liveLines, verdictLines } from '../../src/ui/terminal/view.mjs';
import { makeTheme, strip, width, truncate, fmtMs, fmtUsd, bar, spark } from '../../src/ui/terminal/theme.mjs';
import { renderSprite, SPRITE_SIZE } from '../../src/ui/terminal/sprite.mjs';

const color = makeTheme({ color: true, unicode: true });
const plain = makeTheme({ color: false, unicode: true });
const ascii = makeTheme({ color: false, unicode: false });
const T = (t, type, p = {}) => ({ type, t, ...p });
const F = (t, key, rule, sev, detail, mode = 'light') => T(t, 'finding', { key, rule, severity: sev, element: 'button.primary', detail, mode });
const dec = (t, key, by, decision, confidence, ms = 280) => T(t, 'decision', { kind: 'triage', key, by, decision, confidence, ms, inputTokens: 700 });
const dig = { type: 'run.start', t: 0, command: 'dig', url: 'http://localhost:5200/apps/netwrk-web/sales', modes: ['light', 'dark'], triage: 'cascade', runId: 'r', runDir: '/runs/r' };
const build = (events) => events.reduce(reduce, createState({ pricing: { models: { 'claude-sonnet-5-5': { inputPerM: 2 } } } }));
const busy = build([dig, T(1, 'page.loaded', { elements: 482, ms: 1100 }), F(2, 'a', 'contrast', 'medium', 'contrast 4.43:1, needs 4.5:1 (light mode)'), F(2, 'b', 'control-unlabeled', 'high', 'form control has no label or aria-label'),
  F(2, 'c', 'text-truncated-no-title', 'low', 'truncated text has no title attribute'), dec(3, 'a', 'jev', 'real', 0.91), dec(3, 'b', 'jev', 'uncertain', 0.5), dec(4, 'c', 'jev', 'false_positive', 0.95),
  T(5, 'stage.end', { model: 'jev-1.13', costUsd: 0.0004, spentUsd: 0.0004 })]);
const finished = (status, exitCode, extra = {}) => build([dig, T(1, 'page.loaded', { elements: 10, ms: 1 }), ...(status === 'defects' ? [F(2, 'a', 'contrast', 'high', 'x'), dec(3, 'a', 'jev', 'real', 0.9)] : []),
  ...(status === 'not_run' ? [T(2, 'not_run', { problem: 'http://x needs login: redirected to /login' })] : []), T(9, 'run.end', { status, exitCode, totalMs: 4200, totalUsd: 0.0031, ...extra })]);

test('no line is ever wider than the terminal, at any size', () => {
  for (const cols of [40, 50, 60, 72, 80, 100, 120, 160]) for (const rows of [20, 26, 34, 50]) {
    for (const l of liveLines(busy, color, { cols, rows, frame: 3, now: 5000 })) assert.ok(width(l) <= cols, `cols=${cols} rows=${rows}: "${strip(l)}" is ${width(l)} wide`);
  }
});

test('the verdict card is a perfect rectangle (every row the same width)', () => {
  for (const s of [finished('defects', 1), finished('pass', 0), finished('not_run', 2)]) {
    const lines = verdictLines(s, plain, { cols: 100 }).filter(Boolean);
    assert.equal(new Set(lines.map((l) => width(l))).size, 1, lines.map((l) => width(l)).join(','));
  }
});

test('NOT RUN can never look like a pass', () => {
  const card = verdictLines(finished('not_run', 2), plain).join('\n');
  assert.match(card, /NOT RUN/); assert.match(card, /failure, not a pass/); assert.match(card, /needs login/);
  assert.doesNotMatch(card, /CLEAN|SURFACED/);
  const live = liveLines(finished('not_run', 2), plain, { cols: 100, rows: 40 }).join('\n');
  assert.match(live, /NOT RUN/);
});

test('status words match the outcome', () => {
  assert.match(verdictLines(finished('pass', 0), plain).join('\n'), /SURFACED/);
  assert.match(verdictLines(finished('defects', 1), plain).join('\n'), /NUGGETS FOUND/);
  assert.match(verdictLines(finished('defects', 1), plain).join('\n'), /exit 1/);
});

test('live panel shows who decided each nugget and the model ladder', () => {
  const text = liveLines(busy, plain, { cols: 110, rows: 44, frame: 0, now: 5000 }).join('\n');
  for (const w of ['RULES', 'JEV', 'CLAUDE', 'HUMAN', 'NUGGETS', 'control-unlabeled', 'asking Claude', 'real', 'dismissed']) assert.ok(text.includes(w), `missing ${w}`);
  assert.match(text, /Jev 91%/);
});

test('the highest severity is listed first', () => {
  const rows = liveLines(busy, plain, { cols: 110, rows: 44 }).filter((l) => /^ [●*] (HIGH|MEDIUM|LOW)/.test(l)).map((l) => l.trim().split(/\s+/)[1]);
  assert.deepEqual(rows, ['HIGH', 'MEDIUM', 'LOW']);
});

test('colour off means zero escape codes; ascii means zero non-ASCII glyphs from the UI itself', () => {
  const p = [...liveLines(busy, plain, { cols: 100, rows: 40 }), ...verdictLines(finished('defects', 1), plain)].join('\n');
  assert.equal(p, strip(p)); assert.doesNotMatch(p, /\x1b/);
  const a = [...liveLines(busy, ascii, { cols: 100, rows: 40 }), ...verdictLines(finished('pass', 0), ascii)].join('\n');
  assert.doesNotMatch(a.replace(/[→≥·]/g, ''), /[^\x00-\x7f]/, 'ascii theme leaked a unicode glyph');
});

test('tunnel view shows coverage, the control being tested, and skipped ones', () => {
  const s = build([{ type: 'run.start', t: 0, command: 'tunnel', url: 'u', max: 20, picker: 'jev', riskScreen: true, triage: 'none' }, T(1, 'page.loaded', { elements: 100 }), T(2, 'control.found', { count: 10 }),
    T(3, 'control.pick', { n: 1, role: 'tab', label: 'Pipeline', by: 'jev', confidence: 0.93 }), T(4, 'control.result', { n: 1, label: 'Pipeline', changed: true }),
    T(5, 'control.pick', { n: 2, role: 'button', label: 'Pay now', by: 'jev', confidence: 0.9 }), T(6, 'control.result', { n: 2, label: 'Pay now', skipped: 'risk screen (jev)' }),
    T(7, 'control.pick', { n: 3, role: 'link', label: 'Reports', by: 'heuristic', confidence: 0.6 })]);
  const text = liveLines(s, plain, { cols: 100, rows: 44, now: 8000 }).join('\n');
  for (const w of ['TUNNEL', '2/10 controls', 'skipped', 'Pipeline', 'Reports', 'picked by heuristic']) assert.ok(text.includes(w), `missing ${w}`);
});

test('a rules-only run shows no model ladder at all (no fake Jev/Claude rows)', () => {
  const s = build([{ ...dig, triage: 'none' }, T(1, 'page.loaded', { elements: 5 }), F(2, 'a', 'contrast', 'low', 'x')]);
  const text = liveLines(s, plain, { cols: 100, rows: 40 }).join('\n');
  assert.match(text, /rules only/); assert.doesNotMatch(text, /JEV|CLAUDE|HUMAN/);
});

test('helpers: truncate respects width, formatters are stable', () => {
  assert.equal(truncate('abcdef', 4), 'abc…'); assert.equal(truncate('ab', 4), 'ab');
  assert.equal(width('日本'), 4);
  assert.equal(fmtMs(281), '281ms'); assert.equal(fmtMs(1500), '1.5s'); assert.equal(fmtMs(125000), '2m05s'); assert.equal(fmtMs(null), '–');
  assert.equal(fmtUsd(0), '$0'); assert.equal(fmtUsd(0.000131), '$0.0001'); assert.equal(fmtUsd(0.0314), '$0.031');
  assert.equal(strip(bar(plain, 0.5, 10)).length, 10); assert.equal(strip(bar(plain, 7, 10)).length, 10, 'clamped');
  assert.equal(spark(plain, [1, 2, 3]).length, 3);
});

test('mole sprite: right size, fits the header, degrades without colour', () => {
  assert.deepEqual([SPRITE_SIZE.width, SPRITE_SIZE.height], [44, 32]);
  const full = renderSprite({ shrink: 1, color: true }), half = renderSprite({ shrink: 2, color: true });
  assert.equal(full.length, 16); assert.equal(half.length, 8);
  assert.ok(full.every((l) => width(l) <= 44) && half.every((l) => width(l) <= 22));
  assert.ok(full.join('').includes('\x1b[38;2;'), 'truecolour half blocks');
  const fallback = renderSprite({ color: false });
  assert.ok(fallback.length <= 4 && fallback.join('').indexOf('\x1b') === -1);
});
