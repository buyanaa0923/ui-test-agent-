// The live browser overlay: the mole walks to each control, badges show who decided what, and a laser sweeps the
// page as every element is checked. It is a subscriber to the event bus, exactly like the terminal UI, so it can only
// ever show what really happened. Injected into every navigation of the context; hidden during measurement and screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createState, reduce } from '../state.mjs';
import { groupFindings, stripMode } from '../../core/findings.mjs';

const dir = import.meta.dirname;
const INJECT = fs.readFileSync(path.join(dir, 'inject.js'), 'utf8');
const SPRITE = createRequire(import.meta.url)('../terminal/mole.sprite.json');

const usd = (u) => (u == null ? '$0' : u === 0 ? '$0' : u < 0.01 ? `$${u.toFixed(4)}` : `$${u.toFixed(3)}`);
const pct = (c) => (c == null ? '' : ` ${Math.round(c * 100)}%`);

export async function attachOverlay({ context, page, bus }) {
  await context.addInitScript({ content: `window.__MOLE_SPRITE=${JSON.stringify(SPRITE)};\n${INJECT}` });

  let state = createState();
  let hidden = false;
  let feed = [];
  let final = null;
  let startedWall = Date.now();

  const call = (fn, ...args) => page.evaluate(([f, a]) => (window.__mole ? window.__mole[f](...a) : null), [fn, args]).catch(() => null);
  const say = (kind, text) => { feed = [...feed.slice(-3), { kind, text }]; if (!hidden) call('feed', kind, text); };

  const hud = () => {
    const groups = groupFindings(state.findings);
    const done = state.steps.filter((x) => x.status === 'ok').length;
    const progress = state.command === 'tunnel' ? Math.min(1, (state.tunnel.exercised + state.tunnel.skipped) / Math.max(state.tunnel.found, 1)) : state.steps.length ? done / state.steps.length : 0;
    const sub = final ? 'done' : state.phase === 'judging' ? 'sniffing with Jev → Claude' : state.command === 'tunnel' ? `tunnelling · ${state.tunnel.exercised + state.tunnel.skipped}/${state.tunnel.found || '?'} controls` : state.steps.find((x) => x.status === 'run')?.label ? `digging · ${state.steps.find((x) => x.status === 'run').label.toLowerCase()}` : 'digging';
    return { sub, url: state.url, elements: state.elements, nuggets: groups.length, usd: usd(state.costUsd), progress: final ? 1 : progress, startedAtWall: startedWall, feed, ...(final ? { final } : {}) };
  };
  const push = () => { if (!hidden) return call('hud', hud()); };

  // A navigation wipes the page (and the overlay with it): put the HUD back.
  page.on('load', () => { push(); });
  page.on('domcontentloaded', () => { push(); });

  bus.on((e) => {
    state = reduce(state, e);
    switch (e.type) {
      case 'run.start': startedWall = Date.now(); feed = []; final = null; break;
      case 'page.loaded': say('rule', `loaded ${e.elements} elements`); break;
      case 'mode.done':
        call('sweep', e.checked || [], 800);
        say('rule', `${e.mode}: ${e.findings} nugget${e.findings === 1 ? '' : 's'} in ${e.elements} elements`);
        break;
      case 'finding': say(e.severity === 'high' ? 'fail' : 'rule', `${e.rule} · ${e.element} · ${stripMode(e.detail)}`.slice(0, 60)); break;
      case 'decision':
        if (e.kind !== 'triage') break;
        if (e.by === 'jev') say('jev', e.decision === 'uncertain' ? `Jev unsure${pct(e.confidence)} → asking Claude` : `Jev: ${e.decision === 'real' ? 'real' : 'not a defect'}${pct(e.confidence)} · ${Math.round(e.ms || 0)}ms`);
        else if (e.by === 'claude') say('claude', `Claude: ${e.decision === 'real' ? 'real' : e.decision === 'false_positive' ? 'not a defect' : e.decision}`);
        else say('human', 'needs a person');
        break;
      case 'control.pick': call('target', e.rect, `#${e.n} ${e.label} · ${e.by}${pct(e.confidence)}`); break;
      case 'control.risk': call('badge', `${e.decision === 'safe' ? 'safe ✔' : 'risky ✖ skip'} · ${e.by}${pct(e.confidence)}`, e.decision === 'safe' ? 'safe' : 'risky'); say(e.decision === 'safe' ? 'pass' : 'human', `${e.label.slice(0, 24)}: ${e.decision} (${e.by}${pct(e.confidence)})`); break;
      case 'control.click': call('click'); break;
      case 'control.result':
        say(e.skipped ? 'human' : e.deadClick || e.errors || e.failedRequests ? 'fail' : 'pass', `${e.label.slice(0, 26)}: ${e.skipped ? 'skipped' : e.deadClick ? 'no effect' : e.errors ? 'JS error' : e.failedRequests ? 'failed request' : e.dialogOpened ? 'opened dialog' : e.changed ? 'changed page' : 'ok'}`);
        break;
      case 'run.result': {
        final = { status: e.status, text: e.status === 'pass' ? 'SURFACED · CLEAN' : e.status === 'defects' ? `NUGGETS FOUND · ${e.findings}` : 'CAVE-IN · NOT RUN' };
        call('clear');
        break;
      }
      default:
    }
    if (['stage.end', 'mode.done', 'control.result', 'run.result', 'decision', 'finding'].includes(e.type)) push();
  }, { replay: true });

  return {
    hide: async () => { hidden = true; await call('hide'); },
    show: async () => { hidden = false; await call('show'); },
  };
}
