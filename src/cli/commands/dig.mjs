import { EventBus } from '../../core/events.mjs';
import { dig } from '../../engine/dig.mjs';
import { attachTerminal } from '../../ui/terminal/index.mjs';
import { outputOptions, browserOptions, modelOptions, designOptions, sourceOpts, terminalOptions, wantsWatch, num, resolveTriage, overlayAttach } from '../options.mjs';

export default {
  name: 'dig',
  summary: 'Check a page against the design contract (light, and dark when the page has it)',
  usage: 'mole dig <url> [options]',
  positionals: 1,
  options: {
    modes: { type: 'string', default: 'light,dark', description: 'colour modes to check' },
    width: { type: 'string', description: 'viewport width (default: 1280 desktop, 390 mobile)' },
    height: { type: 'string', description: 'viewport height (default: 800 desktop, 844 mobile)' },
    name: { type: 'string', default: 'scan', description: 'label for the run folder' },
    ...designOptions, ...modelOptions, ...browserOptions, ...outputOptions,
  },
  async run({ values, positionals }) {
    const bus = new EventBus();
    const term = attachTerminal(bus, terminalOptions(values));
    const attach = await overlayAttach(values);
    const watch = wantsWatch(values);
    const result = await dig({
      url: positionals[0], modes: values.modes.split(','), viewport: values.width || values.height ? { width: num(values.width, values.platform === 'mobile' ? 390 : 1280), height: num(values.height, values.platform === 'mobile' ? 844 : 800) } : undefined,
      design: values.design || null, platform: values.platform || null, ...sourceOpts(values), name: values.name,
      triage: resolveTriage(values), storageState: values['storage-state'] || process.env.UTA_STORAGE_STATE || null, ssoButton: values['sso-button'] || process.env.UTA_SSO_BUTTON || null,
      headed: watch, record: !!values.record, pace: watch ? num(values.pace, 900) : 0, maxUsd: values['max-usd'] != null ? num(values['max-usd']) : undefined,
    }, { bus, attach });
    term.stop();
    return result.exitCode;
  },
};
