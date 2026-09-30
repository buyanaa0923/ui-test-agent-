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
      case 'run.start': out(`${t.brand(t.sym.dig)} ${t.brand(t.bold('MOLE'))} ${e.command} ${e.url}${e.triage && e.triage !== 'none' ? t.mute(`  (${e.triage === 'cascade' ? 'Jev → Claude → human' : 'Claude only'})`) : e.command === 'dig' ? t.mute('  (rules only)') : ''}`); break;
      case 'page.loaded': out(`${t.pass(t.sym.ok)} loaded ${e.elements} elements${e.ms ? t.mute(' in ' + fmtMs(e.ms)) : ''}`); break;
      case 'mode.done': out(`${t.pass(t.sym.ok)} ${e.mode}: ${e.elements} checked, ${e.findings} nugget${e.findings === 1 ? '' : 's'}`); break;
      case 'note': out(`${t.faint('note: ' + e.message)}`); break;
      case 'finding': { const k = findingKey(e); if (seen.has(k)) break; seen.add(k); out(`${t.sev(e.severity, t.sym.dot)} ${t.sev(e.severity, `[${e.severity}]`)} ${e.rule} ${t.mute(truncate(e.element, 28))} ${truncate(e.detail, 90)}`); break; }
      case 'decision':
        if (e.kind !== 'triage') break;
        if (e.event === 'jev_failed') out(`  ${t.mute(t.sym.right)} ${t.by('jev', 'Jev')} unavailable, escalating to ${t.by('claude', 'Claude')}`);
        else if (e.by === 'jev') out(`  ${t.mute(t.sym.right)} ${t.by('jev', 'Jev')} ${e.decision === 'uncertain' ? t.warn(`unsure${conf(e.confidence)} ${t.sym.up} Claude`) : `${e.decision === 'real' ? t.fail('real') : t.mute('not a defect')}${conf(e.confidence)}`} ${t.mute(fmtMs(e.ms))}`);
        else if (e.by === 'claude') out(`  ${t.mute(t.sym.right)} ${t.by('claude', 'Claude')} ${e.decision === 'real' ? t.fail('real') : e.decision === 'false_positive' ? t.mute('not a defect') : t.warn(e.decision)}`);
        else out(`  ${t.mute(t.sym.right)} ${t.by('human', 'needs a person')}`);
        break;
      case 'control.pick': out(`${t.brand(t.sym.arrow)} #${e.n} ${e.role} "${truncate(e.label, 32)}" ${t.mute(`picked by ${e.by}${conf(e.confidence)}`)}`); break;
      case 'control.risk': out(`  ${t.mute(t.sym.right)} risk screen: ${e.decision === 'safe' ? t.pass('safe') : t.fail(e.decision || 'skipped')} ${t.mute(`(${e.by}${conf(e.confidence)})`)}`); break;
      case 'control.result':
        out(`  ${t.mute(t.sym.right)} ${e.skipped ? t.warn(`skipped: ${e.skipped}`) : e.deadClick ? t.fail('no effect') : e.errors ? t.fail(`${e.errors} JS error(s)`) : e.failedRequests ? t.fail('failed request') : t.pass(e.dialogOpened ? 'opened a dialog' : e.changed ? 'changed the page' : 'ok')}`);
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
