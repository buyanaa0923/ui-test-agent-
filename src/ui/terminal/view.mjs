// Pure view: (state, options) -> array of text lines. No I/O, no clock reads: the caller passes `now` and `frame`.
// Used by the live renderer (redrawn in place), the final verdict card, and tests (snapshot without a terminal).
import { renderSprite } from './sprite.mjs';
import { bar, spark, padEnd, padStart, truncate, width, fmtMs, fmtUsd } from './theme.mjs';
import { counted, uniqueCounted, groupFindings, bySeverity, median, decidedBy, claudeOnlyFloorUsd } from '../state.mjs';
import { stripMode } from '../../core/findings.mjs';

const TAGLINE = 'digging up UI bugs before your users do';
const sevOrder = { high: 0, medium: 1, low: 2 };
const spin = (t, frame) => t.sym.spin[frame % t.sym.spin.length];

function stepGlyph(t, s, frame) {
  if (s.status === 'ok') return t.pass(t.sym.ok);
  if (s.status === 'fail') return t.fail(t.sym.bad);
  if (s.status === 'run') return t.brand(spin(t, frame));
  return t.faint(t.sym.ring);
}

function pipeline(t, s, frame) {
  return s.steps.map((x) => `${stepGlyph(t, x, frame)} ${x.status === 'wait' ? t.faint(x.label) : x.label}${x.ms != null ? t.mute(' ' + fmtMs(x.ms)) : ''}`).join(t.faint(`  ${t.sym.arrow}  `));
}

function headerLines(t, s, o) {
  const running = s.phase !== 'done' && s.phase !== 'not_run';
  const verb = s.command === 'tunnel' ? 'tunnelling through controls' : 'digging up UI bugs';
  const title = `${t.brand(t.bold('MOLE'))}  ${t.mute(running ? verb : TAGLINE)}`;
  const mode = s.command === 'tunnel'
    ? `tunnel · picker ${s.picker || 'heuristic'}${s.riskScreen ? ' · risk screen' : ''}${s.max ? ` · up to ${s.max} clicks` : ''}`
    : `dig · ${s.modes.join('+') || 'light+dark'}${s.contract ? ` · ${s.contract.platform}` : ''}${s.triage === 'cascade' ? ' · Jev → Claude → human' : s.triage === 'claude' ? ' · Claude only' : ' · rules only (no model)'}`;
  const target = `${t.mute('target')}  ${truncate(s.url || '', o.cols - 34)}`;
  const how = `${t.mute('mode  ')}  ${mode}`;
  const design = s.contract ? `${t.mute('design')}  ${truncate(s.contract.name, o.cols - 34)}` : null;
  const note = s.notes.length ? t.faint(`note: ${truncate(s.notes.at(-1), o.cols - 34)}`) : null;
  if (o.compact) return [` ${title}`, ` ${target}`, ` ${how}`, ...(design ? [` ${design}`] : []), ...(note ? [` ${note}`] : [])];

  const info = [title, t.faint(t.sym.hr.repeat(Math.min(48, o.cols - 30))), target, how, ...(design ? [design] : []), ...(note ? [note] : [])];
  const sprite = renderSprite({ shrink: 2, color: t.color });
  const rows = Math.max(sprite.length, info.length + 1);
  const dirt = running ? t.brand(['· ˙ ·', '˙ · ˙'][o.frame % 2]) : '';
  const out = [];
  for (let i = 0; i < rows; i++) {
    const left = padEnd(sprite[i] || '', 24);
    const right = i === 0 ? dirt : info[i - 1] || '';
    out.push(` ${left}${right}`.replace(/\s+$/, ''));
  }
  return out;
}

function ladderLines(t, s, o) {
  if (s.triage === 'none' && !s.findings.length) return [];
  const groups = groupFindings(s.findings);
  const total = groups.length;
  const lab = (who, name) => t.by(who, t.bold(padEnd(name, 8)));
  const out = [''];
  if (s.command === 'tunnel') out.push(` ${lab('rule', 'FOUND')} ${t.bold(String(total))} problem${total === 1 ? '' : 's'} while clicking ${t.mute('(dead buttons, JS errors, failed requests)')}`);
  else out.push(` ${lab('rule', 'RULES')} ${t.bold(String(total))} distinct nugget${total === 1 ? '' : 's'} flagged by ${t.mute('11 deterministic checks')}${s.findings.length !== total ? t.mute(` (${s.findings.length} across ${s.modes.join(' + ')})`) : ''}`);
  if (s.triage === 'cascade') {
    const p50 = median(s.jev.ms);
    out.push(` ${lab('jev', 'JEV')} ${bar(t, total ? s.jev.settled / total : 0, 16, 'jev')} ${padStart(String(s.jev.settled), 2)}/${total} settled${s.jev.unsure ? t.warn(`  ${s.jev.unsure} unsure ${t.sym.up}`) : ''}${p50 != null ? t.mute(`  p50 ${fmtMs(p50)}`) : ''}  ${t.mute(fmtUsd(s.jev.usd))}`);
    out.push(` ${lab('claude', 'CLAUDE')} ${bar(t, total ? s.claude.consulted / total : 0, 16, 'claude')} ${padStart(String(s.claude.consulted), 2)}/${total} consulted  ${t.mute(fmtUsd(s.claude.usd))}`);
    out.push(` ${lab('human', 'HUMAN')} ${s.human ? t.warn(`${s.human} need${s.human === 1 ? 's' : ''} a person`) : t.mute('0 need a person')}`);
  } else if (s.triage === 'claude') {
    out.push(` ${lab('claude', 'CLAUDE')} ${bar(t, total ? groups.filter((g) => g.verdict).length / total : 0, 16, 'claude')} judged ${groups.filter((g) => g.verdict).length}/${total}  ${t.mute(fmtUsd(s.claude.usd))}`);
  }
  return out;
}

function verdictCell(t, f, frame) {
  if (f.pending) return t.by('claude', `${spin(t, frame)} asking Claude`);
  if (f.verdict === 'real') return `${t.fail(t.sym.dot)} real${f.by === 'jev' && f.confidence != null ? t.mute(` · Jev ${Math.round(f.confidence * 100)}%`) : f.by ? t.mute(` · ${f.by}`) : ''}`;
  if (f.verdict === 'false_positive') return t.mute(`${t.sym.ok} dismissed · ${f.by}`);
  if (f.verdict === 'unjudged') return t.warn(`${t.sym.warn} needs a person`);
  if (f.verdict === 'uncertain') return t.warn(`${t.sym.warn} uncertain`);
  return '';
}

function nuggetLines(t, s, o) {
  if (!s.findings.length) return s.phase === 'checking' ? ['', ` ${t.mute('no nuggets yet...')}`] : [];
  const rows = groupFindings(s.findings).sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));
  const out = ['', ` ${t.bold('NUGGETS')}`];
  const RULE = o.cols >= 110 ? 24 : 20, EL = o.cols >= 110 ? 26 : 18, VERDICT = 20; // wider terminal, less truncation
  const detailW = o.cols - (1 + 9 + RULE + 1 + EL + 1 + 1 + VERDICT);
  const wrap = detailW < 26; // narrow terminal: detail goes on its own line instead of squeezing the verdict off screen
  const cap = wrap ? Math.floor(o.maxNuggets / 2) || 1 : o.maxNuggets;
  for (const f of rows.slice(0, cap)) {
    const dim = f.verdict === 'false_positive';
    const partial = f.mode !== 'flow' && f.modes.length < Math.max(1, s.modes.length) ? ` ·${f.modes.join('+')}` : '';
    const sev = t.sev(f.severity, padEnd(`${t.sym.dot} ${(f.severity || '').toUpperCase()}`, 9));
    const rule = padEnd(dim ? t.mute(truncate(f.rule, RULE - 1)) : truncate(f.rule, RULE - 1), RULE);
    // Where to fix it beats what it is: show file:line (just the file name, to fit) when the source was found.
    const at = f.where?.file ? `${f.where.file.split('/').pop()}${f.where.line ? ':' + f.where.line : ''}` : null;
    const el = padEnd(at ? t.brand(truncate(at + partial, EL - 1)) : t.mute(truncate(f.element + partial, EL - 1)), EL);
    const detail = truncate(stripMode(f.detail), wrap ? o.cols - 6 : detailW - 1);
    if (wrap) out.push(` ${sev}${rule}${el} ${verdictCell(t, f, o.frame)}`.replace(/\s+$/, ''), `          ${t.mute(detail)}`);
    else out.push(` ${sev}${rule}${el} ${padEnd(dim ? t.mute(detail) : detail, detailW)} ${verdictCell(t, f, o.frame)}`.replace(/\s+$/, ''));
  }
  if (rows.length > cap) out.push(` ${t.mute(`+ ${rows.length - cap} more (full list in report.json)`)}`);
  return out;
}

function tunnelLines(t, s, o) {
  if (s.command !== 'tunnel') return [];
  const tn = s.tunnel;
  const out = [''];
  const denom = Math.max(tn.found, tn.exercised + tn.skipped, 1);
  out.push(` ${t.brand(t.bold(padEnd('TUNNEL', 8)))} ${bar(t, (tn.exercised + tn.skipped) / denom, 20, 'brand')} ${tn.exercised + tn.skipped}/${denom} controls  ${t.mute(`${tn.exercised} clicked · ${tn.skipped} skipped by risk screen`)}${tn.dead ? t.warn(`  ${tn.dead} dead click${tn.dead === 1 ? '' : 's'}`) : ''}`);
  const c = tn.current;
  if (c) {
    const who = c.by === 'jev' ? 'jev' : c.by === 'claude' ? 'claude' : 'rule';
    const pick = `${t.by(who, c.by || 'picker')}${c.confidence != null ? t.mute(` ${Math.round(c.confidence * 100)}%`) : ''}`;
    const risk = c.risk ? `  ${t.mute('risk')} ${c.risk.decision === 'safe' ? t.pass('safe') : t.fail(c.risk.decision)}${t.mute(` ${c.risk.by}${c.risk.confidence != null ? ' ' + Math.round(c.risk.confidence * 100) + '%' : ''}`)}` : '';
    out.push(` ${t.brand(spin(t, o.frame))} ${t.bold(`#${c.n}`)} ${c.role} ${t.fg('#FFFFFF', `"${truncate(c.label, 30)}"`)}  ${t.mute('picked by')} ${pick}${risk}`);
  }
  for (const r of tn.log.slice(-o.maxSteps)) {
    const glyph = r.skipped ? t.warn(t.sym.warn) : r.deadClick || r.errors || r.failedRequests ? t.fail(t.sym.bad) : t.pass(t.sym.ok);
    const what = r.skipped ? t.warn(`skipped · ${r.skipped}`) : r.deadClick ? t.fail('no effect') : r.errors ? t.fail(`${r.errors} JS error${r.errors === 1 ? '' : 's'}`) : r.failedRequests ? t.fail('failed request') : t.mute(r.dialogOpened ? 'opened a dialog' : r.changed ? 'changed the page' : 'ok');
    out.push(`   ${glyph} ${t.mute(padStart(String(r.n), 2))} ${padEnd(`${r.role || ''} "${truncate(r.label, 28)}"`, 40)} ${what}`);
  }
  return out;
}

function footerLines(t, s, o) {
  const elapsed = s.end ? s.end.totalMs : Math.max(0, (o.now ?? s.t) - s.startedAt);
  const parts = [`${t.sym.clock} ${fmtMs(elapsed)}`, fmtUsd(s.costUsd)];
  if (s.jev.ms.length > 1) parts.push(`Jev latency ${spark(t, s.jev.ms)}`);
  if (s.elements) parts.push(`${s.elements} elements`);
  return ['', ` ${t.faint(t.sym.hr.repeat(Math.min(o.cols - 2, 72)))}`, ` ${t.mute(parts.join('  ·  '))}`];
}

// The live panel, redrawn in place while the run is going.
export function liveLines(s, t, o = {}) {
  const opts = { cols: 100, rows: 40, frame: 0, now: undefined, ...o };
  opts.compact = o.compact ?? (opts.rows < 34 || opts.cols < 72);
  opts.maxNuggets = o.maxNuggets ?? Math.max(3, Math.min(10, opts.rows - (opts.compact ? 16 : 30)));
  opts.maxSteps = o.maxSteps ?? Math.max(3, Math.min(6, opts.rows - (opts.compact ? 18 : 30)));
  const lines = [
    '', ...headerLines(t, s, opts), '', ` ${pipeline(t, s, opts.frame)}`,
    ...(s.phase === 'not_run' ? ['', ` ${t.warn(t.bold(`${t.sym.warn} NOT RUN`))} ${s.problem}`] : []),
    ...ladderLines(t, s, opts), ...nuggetLines(t, s, opts), ...tunnelLines(t, s, opts), ...footerLines(t, s, opts),
  ];
  return lines.map((l) => { const f = t.fit(l); return width(f) > opts.cols ? truncate(f, opts.cols) : f; });
}

// The card printed once when the run ends: status, defects, who decided, time, cost. Rounded box, one glance.
export function verdictLines(s, t, o = {}) {
  const cols = Math.min(o.cols ?? 100, 80);
  const inner = cols - 4;
  const e = s.end || { status: 'pass', exitCode: 0, totalMs: 0, totalUsd: 0 };
  const uniq = uniqueCounted(s).length, raw = counted(s).length;
  const head = e.status === 'not_run' ? { txt: 'CAVE-IN  ·  NOT RUN', c: 'warn', sub: 'Nothing was tested. This is a failure, not a pass.' }
    : e.status === 'defects' ? { txt: `NUGGETS FOUND  ·  ${uniq} defect${uniq === 1 ? '' : 's'}`, c: 'fail', sub: raw !== uniq ? `Real bugs dug up (${raw} findings across ${s.modes.join(' + ')}). Fix them and dig again.` : 'Real bugs dug up. Fix them and dig again.' }
      : { txt: 'SURFACED  ·  CLEAN', c: 'pass', sub: 'No defects found in what was tested.' };
  const paint = (x) => t[head.c](x);
  const side = paint(t.unicode ? '│' : '|');
  const row = (txt = '') => `${side} ${padEnd(t.fit(txt), inner)} ${side}`;
  const edge = (l, r) => paint(`${l}${(t.unicode ? '─' : '-').repeat(cols - 2)}${r}`);
  const lab = (n) => t.bold(padEnd(n, 11));
  const out = ['', edge(t.unicode ? '╭' : '+', t.unicode ? '╮' : '+'), row(t.bold(paint(head.txt))), row(t.mute(truncate(head.sub, inner))), row()];
  if (e.status === 'not_run') out.push(row(truncate(s.problem || '', inner)), row());
  else {
    const sev = bySeverity(s);
    const parts = ['high', 'medium', 'low'].filter((k) => sev[k]).map((k) => t.sev(k, `${sev[k]} ${k}`));
    if (parts.length) out.push(row(`${lab('Severity')}${parts.join(t.mute('  ·  '))}`));
    const d = decidedBy(s);
    if (s.triage === 'cascade' && s.findings.length) out.push(row(`${lab('Decided by')}${t.by('jev', `Jev ${d.jev}`)}${t.mute('  ·  ')}${t.by('claude', `Claude ${d.claude}`)}${t.mute('  ·  ')}${t.by('human', `person ${d.human}`)}${d.dismissed ? t.mute(`  ·  ${d.dismissed} dismissed`) : ''}`));
    if (s.command === 'tunnel' && e.coverage) out.push(row(`${lab('Coverage')}${e.coverage.exercised}/${e.coverage.controlsFound} controls clicked${e.coverage.skippedByRiskScreen ? t.mute(` · ${e.coverage.skippedByRiskScreen} skipped by risk screen`) : ''}`), row(`${lab('')}${t.mute(`stopped: ${e.coverage.stopReason}`)}`));
    if (s.command === 'dig') out.push(row(`${lab('Checked')}${s.elements} elements · ${s.modes.join(' + ')}`));
  }
  const floor = claudeOnlyFloorUsd(s);
  const saving = floor && e.totalUsd < floor ? t.mute(`  (Claude-only: ≥ ${fmtUsd(floor)})`) : '';
  out.push(row(`${lab('Time')}${fmtMs(e.totalMs)}`), row(`${lab('Cost')}${fmtUsd(e.totalUsd)}${saving}`));
  out.push(row(), row(`${t.mute('exit')} ${e.exitCode}  ${t.mute('·')}  ${t.mute(truncate(s.runDir || '', inner - 12))}`));
  if (e.video) out.push(row(`${t.mute('video')} ${truncate(e.video, inner - 8)}`));
  out.push(edge(t.unicode ? '╰' : '+', t.unicode ? '╯' : '+'), '');
  return out;
}

export const bannerLines = (t, { version = '' } = {}) => {
  const sprite = renderSprite({ shrink: 1, color: t.color });
  return ['', ...sprite.map((l) => `  ${l}`), '', `  ${t.brand(t.bold('MOLE'))} ${t.mute(version)}  ${t.mute(TAGLINE)}`, ''];
};
