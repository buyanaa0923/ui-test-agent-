// Streaming line logger for non-TTY output (CI logs, Claude Code's Bash tool, pipes). One event, one line,
// still structured and colourful when colour is allowed, and it ends with the same verdict card.
import { createState, reduce } from '../state.mjs';
import { findingKey } from '../../core/findings.mjs';
import { verdictLines } from './view.mjs';
import { fmtMs, fmtUsd, truncate } from './theme.mjs';

export function startPlain(bus, { stream = process.stdout, theme: t, pricing = null } = {}) {
  let state = createState({ pricing });
  const seen = new Set(); // identical findings in the second colour mode are one bug, printed once
  const out = (s = '') => stream.write(t.fit(s) + '\n');
  const conf = (c) => (c == null ? '' : ` ${Math.round(c * 100)}%`);

  const off = bus.on((e) => {
    state = reduce(state, e);
    switch (e.type) {
      case 'run.start': out(`${t.brand(t.sym.dig)} ${t.brand(t.bold('MOLE'))} ${e.command} ${e.url}${e.triage && e.triage !== 'none' ? t.mute(`  (${e.triage === 'cascade' ? 'Jev → Claude → human' : 'Claude only'})`) : e.command === 'dig' ? t.mute('  (rules only)') : ''}${e.contract ? t.mute(`  design: ${e.contract.name} · ${e.contract.platform}`) : ''}`); break;
      case 'page.loaded': out(`${t.pass(t.sym.ok)} loaded ${e.elements} elements${e.ms ? t.mute(' in ' + fmtMs(e.ms)) : ''}`); break;
      case 'mode.done': if (e.page != null) break; out(e.skipped ? `${t.mute('-')} ${e.mode}: skipped, ${e.skipped}` : `${t.pass(t.sym.ok)} ${e.mode}: ${e.elements} checked, ${e.findings} nugget${e.findings === 1 ? '' : 's'}${e.screens > 1 ? t.mute(` (${e.screens} screens)`) : ''}`); break;
      case 'note': out(`${t.faint('note: ' + e.message)}`); break;
      case 'finding': { const k = findingKey(e); if (seen.has(k)) break; seen.add(k); out(`${t.sev(e.severity, t.sym.dot)} ${t.sev(e.severity, `[${e.severity}]`)} ${e.rule} ${t.mute(truncate(e.element, e.mode === 'flow' ? 60 : 28))} ${truncate(e.detail, 90)}${e.where?.file ? t.brand(`  → ${e.where.file}${e.where.line ? ':' + e.where.line : ''}${e.where.confidence === 'low' ? ' (?)' : ''}`) : ''}`); break; }
      case 'decision':
        if (e.kind !== 'triage') break;
        if (e.event === 'jev_failed') out(`  ${t.mute(t.sym.right)} ${t.by('jev', 'Jev')} unavailable, escalating to ${t.by('claude', 'Claude')}`);
        else if (e.by === 'jev') out(`  ${t.mute(t.sym.right)} ${t.by('jev', 'Jev')} ${e.decision === 'uncertain' ? t.warn(`unsure${conf(e.confidence)} ${t.sym.up} Claude`) : `${e.decision === 'real' ? t.fail('real') : t.mute('not a defect')}${conf(e.confidence)}`} ${t.mute(fmtMs(e.ms))}`);
        else if (e.by === 'claude') out(`  ${t.mute(t.sym.right)} ${t.by('claude', 'Claude')} ${e.decision === 'real' ? t.fail('real') : e.decision === 'false_positive' ? t.mute('not a defect') : t.warn(e.decision)}`);
        else out(`  ${t.mute(t.sym.right)} ${t.by('human', 'needs a person')}`);
        break;
      case 'page.measured': out(`${t.pass(t.sym.ok)} ${e.path}${e.state ? ` › ${e.state}` : ''}: ${e.elements} checked, ${e.findings} design nugget${e.findings === 1 ? '' : 's'}${e.skipped?.length ? t.mute(` (${e.skipped.join('+')} skipped: no dark mode)`) : ''}`); break;
      case 'state.enter': out(`${t.brand(t.sym.dig)} ${e.page} › ${e.label} ${t.mute(`(via ${e.from}${e.queued ? `; ${e.queued} more queued` : ''})`)}`); break;
      case 'consistency':
        if (!e.checked) { out(t.faint(`note: ${e.reason}`)); break; }
        if (!e.outliers.length) { out(`${t.pass(t.sym.ok)} style: all ${e.pages} pages look like one site`); break; }
        for (const o of e.outliers) { out(`${t.warn(t.sym.warn)} ${t.warn('style')} ${o.path} does not look like the other ${e.pages - 1} pages ${t.mute('(advisory)')}`); for (const d of o.differences.slice(0, 4)) out(`    ${t.mute(d)}`); }
        break;
      case 'form.fill': out(`${t.brand(t.sym.arrow)} #${e.n} form "${truncate(e.name, 32)}" ${t.mute(`${e.fields} field${e.fields === 1 ? '' : 's'}${e.state ? ` in ${e.state}` : ''}`)}`); break;
      case 'form.result': out(`  ${t.mute(t.sym.right)} ${e.skipped ? t.warn(`form "${truncate(e.name, 32)}" left alone: ${e.skipped}`) : e.problem ? t.fail(`${e.outcome}: ${e.problem}`) : t.pass(`${e.outcome}${e.detail ? ` (${e.detail})` : ''}`)}`); break;
      case 'page.found': out(`  ${t.mute(t.sym.right)} ${t.mute(`new page ${e.path} queued (depth ${e.depth})`)}`); break;
      case 'page.enter': if (e.n > 1) out(`${t.brand(t.sym.dig)} page ${e.n}: ${e.path} ${t.mute(`(depth ${e.depth}, via ${e.from}${e.queued ? `; ${e.queued} more queued` : ''})`)}`); break;
      case 'control.pick': out(`${t.brand(t.sym.arrow)} #${e.n} ${e.role} "${truncate(e.label, 32)}" ${t.mute(`picked by ${e.by}${conf(e.confidence)}`)}`); break;
      case 'control.risk': out(`  ${t.mute(t.sym.right)} risk screen: ${e.decision === 'safe' ? t.pass('safe') : t.fail(e.decision || 'skipped')} ${t.mute(`(${e.by}${conf(e.confidence)})`)}`); break;
      case 'control.result':
        out(`  ${t.mute(t.sym.right)} ${e.skipped ? t.warn(`skipped: ${e.skipped}`) : e.problem ? t.fail(`${e.problem} (${e.navigatedTo})`) : e.deadClick ? t.fail('no effect') : e.errors ? t.fail(`${e.errors} JS error(s)`) : e.failedRequests ? t.fail('failed request') : t.pass(e.opened ? `opened ${e.opened}` : e.dialogOpened ? 'opened a dialog' : e.navigatedTo ? `went to ${e.navigatedTo}` : e.changed ? 'changed the page' : 'ok')}`);
        break;
      case 'not_run': out(`${t.warn(t.sym.warn)} ${t.warn('NOT RUN')} ${e.problem}`); break;
      case 'run.end':
        for (const l of verdictLines(state, t)) out(l);
        break;
      default:
    }
  });
  return { stop: off, get state() { return state; } };
}

// Machine mode: one JSON object per event on stdout (NDJSON). Nothing else is printed there.
export function startJson(bus, { stream = process.stdout } = {}) {
  const off = bus.on((e) => stream.write(JSON.stringify(e) + '\n'));
  return { stop: off };
}
