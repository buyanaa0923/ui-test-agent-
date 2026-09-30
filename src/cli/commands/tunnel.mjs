import { EventBus } from '../../core/events.mjs';
import { tunnel } from '../../engine/tunnel.mjs';
import { attachTerminal } from '../../ui/terminal/index.mjs';
import { outputOptions, browserOptions, designOptions, modelOptions, sourceOpts, resolveTriage, terminalOptions, wantsWatch, num, overlayAttach } from '../options.mjs';

export default {
  name: 'tunnel',
  summary: "Click through an app's controls, follow the pages they reach, design-check every page, and catch dead buttons, broken links, JS errors and failed requests",
  usage: 'mole tunnel <url> [options]',
  positionals: 1,
  options: {
    max: { type: 'string', default: '40', description: 'maximum clicks, across all pages' },
    depth: { type: 'string', default: '2', description: 'follow the pages clicks reach, up to this many clicks away (0 = this page only)' },
    'max-pages': { type: 'string', default: '10', description: 'maximum pages to explore' },
    'max-per-page': { type: 'string', description: 'maximum clicks on one page, and in each dialog or panel (default 10 when depth > 0)' },
    'state-depth': { type: 'string', default: '2', description: 'open dialogs, tabs, accordions and menus and test what is inside, up to this many clicks deep (0 = off)' },
    'max-states': { type: 'string', default: '6', description: 'maximum dialogs / panels to explore on one page' },
    forms: { type: 'string', default: 'off', description: 'off | fill (type test data, never send) | submit (also send it: creates data, dev hosts only)' },
    'submit-host': { type: 'string', multiple: true, description: 'allow --forms submit on this host too (repeatable): a test environment you control' },
    'max-submits': { type: 'string', default: '5', description: 'maximum forms submitted in one run' },
    picker: { type: 'string', description: 'heuristic (free) or jev (default: PICKER env or heuristic)' },
    'risk-screen': { type: 'boolean', description: 'ask Jev/Claude whether each control is safe to click (always on with --picker jev)' },
    'allow-origin': { type: 'string', multiple: true, description: 'let requests to this origin through (repeatable): hubs load modules from other ports' },
    name: { type: 'string', default: 'flow', description: 'label for the run folder' },
    'no-design': { type: 'boolean', description: 'only click: skip the design checks on each page' },
    modes: { type: 'string', default: 'light,dark', description: 'colour modes for the design checks on each page' },
    ...designOptions, ...modelOptions, ...browserOptions, ...outputOptions,
  },
  async run({ values, positionals }) {
    const bus = new EventBus();
    const term = attachTerminal(bus, terminalOptions(values));
    const attach = await overlayAttach(values);
    const watch = wantsWatch(values);
    const result = await tunnel({
      url: positionals[0], max: num(values.max, 40), depth: num(values.depth, 2), maxPages: num(values['max-pages'], 10), maxPerPage: values['max-per-page'] != null ? num(values['max-per-page']) : undefined, stateDepth: num(values['state-depth'], 2), maxStates: num(values['max-states'], 6), forms: values.forms, submitHosts: values['submit-host'] || [], maxSubmits: num(values['max-submits'], 5), name: values.name, picker: values.picker || process.env.PICKER || 'heuristic', riskScreen: !!values['risk-screen'],
      triage: values.judge ? 'claude' : 'none', // flow findings: Claude only, on request
      checkDesign: !values['no-design'], design: values.design || null, platform: values.platform || null, modes: values.modes.split(','), designTriage: resolveTriage(values), ...sourceOpts(values),
      allowOrigins: values['allow-origin'] || [],
      storageState: values['storage-state'] || process.env.UTA_STORAGE_STATE || null, ssoButton: values['sso-button'] || process.env.UTA_SSO_BUTTON || null,
      headed: watch, record: !!values.record, pace: watch ? num(values.pace, 500) : 0, maxUsd: values['max-usd'] != null ? num(values['max-usd']) : undefined,
    }, { bus, attach });
    term.stop();
    return result.exitCode;
  },
};
