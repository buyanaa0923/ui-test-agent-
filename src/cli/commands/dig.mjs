import { EventBus } from '../../core/events.mjs';
import { dig } from '../../engine/dig.mjs';
import { attachTerminal } from '../../ui/terminal/index.mjs';
import { outputOptions, browserOptions, modelOptions, terminalOptions, wantsWatch, num, resolveTriage, overlayAttach } from '../options.mjs';

export default {
  name: 'dig',
  summary: 'Scan a page for design-system defects (light + dark)',
  usage: 'mole dig <url> [options]',
  positionals: 1,
  options: {
    modes: { type: 'string', default: 'light,dark', description: 'colour modes to check' },
    width: { type: 'string', default: '1280', description: 'viewport width' },
    height: { type: 'string', default: '800', description: 'viewport height' },
    name: { type: 'string', default: 'scan', description: 'label for the run folder' },
    ...modelOptions, ...browserOptions, ...outputOptions,
  },
  async run({ values, positionals }) {
    const bus = new EventBus();
    const term = attachTerminal(bus, terminalOptions(values));
    const attach = await overlayAttach(values);
    const watch = wantsWatch(values);
    const result = await dig({
      url: positionals[0], modes: values.modes.split(','), viewport: { width: num(values.width, 1280), height: num(values.height, 800) }, name: values.name,
      triage: resolveTriage(values), storageState: values['storage-state'] || process.env.UTA_STORAGE_STATE || null, ssoButton: values['sso-button'] || process.env.UTA_SSO_BUTTON || null,
      headed: watch, record: !!values.record, pace: watch ? num(values.pace, 900) : 0, maxUsd: values['max-usd'] != null ? num(values['max-usd']) : undefined,
    }, { bus, attach });
    term.stop();
    return result.exitCode;
  },
};
