import { runDoctor } from '../../engine/doctor.mjs';
import { detectTheme, bannerLines, version } from '../../ui/terminal/index.mjs';
import { outputOptions } from '../options.mjs';

export default {
  name: 'doctor',
  summary: 'Check that this machine is ready (Node, browser, keys, network)',
  usage: 'mole doctor [--live] [--url http://localhost:5200]',
  positionals: 0,
  options: {
    live: { type: 'boolean', description: 'also make one real Jev call and one real Claude call to prove the keys work (about $0.001)' },
    url: { type: 'string', description: 'also check that the app you want to test is reachable' },
    ...outputOptions,
  },
  async run({ values }) {
    if (values['no-color']) process.env.NO_COLOR = '1';
    const t = detectTheme(process.stdout);
    const json = !!values.json;
    if (!json) process.stdout.write(bannerLines(t, { version: version() }).join('\n') + `\n  ${t.bold('doctor')}\n\n`);
    const r = await runDoctor({
      live: !!values.live, url: values.url || null,
      onResult: json ? () => {} : ({ ok, name, detail, fix }) => {
        const g = ok === true ? t.pass(t.sym.ok) : ok === 'warn' ? t.warn(t.sym.warn) : t.fail(t.sym.bad);
        process.stdout.write(`  ${g} ${name}${detail ? t.mute(' · ' + detail) : ''}\n${ok !== true && fix ? `      ${t.mute('fix:')} ${fix}\n` : ''}`);
      },
    });
    if (json) process.stdout.write(JSON.stringify(r) + '\n');
    else process.stdout.write(`\n  ${r.bad ? t.fail(t.bold(r.summary)) : r.warn ? t.warn(r.summary) : t.pass(t.bold(r.summary))}\n\n`);
    return r.ready ? 0 : 1;
  },
};
