import { startDashboard } from '../../ui/dashboard/server.mjs';

export default {
  name: 'dashboard',
  summary: 'Open the live dashboard (run history, cost, and the judge scorecard)',
  usage: 'mole dashboard [--port 4173]',
  positionals: 0,
  options: { port: { type: 'string', default: '4173', description: 'port to listen on' } },
  async run({ values }) {
    await startDashboard({ port: Number(values.port) || 4173 });
    await new Promise(() => {}); // serve until Ctrl-C
  },
};
