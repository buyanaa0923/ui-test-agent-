import { EventBus } from '../../core/events.mjs';
import { tunnel } from '../../engine/tunnel.mjs';
import { attachTerminal } from '../../ui/terminal/index.mjs';
import { outputOptions, browserOptions, terminalOptions, wantsWatch, num, overlayAttach } from '../options.mjs';

export default {
  name: 'tunnel',
  summary: "Click through a page's controls and catch dead buttons, JS errors and failed requests",
  usage: 'mole tunnel <url> [options]',
  positionals: 1,
  options: {
    max: { type: 'string', default: '20', description: 'maximum clicks' },
    picker: { type: 'string', description: 'heuristic (free) or jev (default: PICKER env or heuristic)' },
    'risk-screen': { type: 'boolean', description: 'ask Jev/Claude whether each control is safe to click (always on with --picker jev)' },
    judge: { type: 'boolean', description: 'have Claude judge the findings' },
    'allow-origin': { type: 'string', multiple: true, description: 'let requests to this origin through (repeatable): hubs load modules from other ports' },
    name: { type: 'string', default: 'flow', description: 'label for the run folder' },
    ...browserOptions, ...outputOptions,
  },
  async run({ values, positionals }) {
    const bus = new EventBus();
    const term = attachTerminal(bus, terminalOptions(values));
    const attach = await overlayAttach(values);
    const watch = wantsWatch(values);
    const result = await tunnel({
      url: positionals[0], max: num(values.max, 20), name: values.name, picker: values.picker || process.env.PICKER || 'heuristic', riskScreen: !!values['risk-screen'],
      triage: values.judge ? 'claude' : 'none', allowOrigins: values['allow-origin'] || [],
      storageState: values['storage-state'] || process.env.UTA_STORAGE_STATE || null, ssoButton: values['sso-button'] || process.env.UTA_SSO_BUTTON || null,
      headed: watch, record: !!values.record, pace: watch ? num(values.pace, 500) : 0, maxUsd: values['max-usd'] != null ? num(values['max-usd']) : undefined,
    }, { bus, attach });
    term.stop();
    return result.exitCode;
  },
};
