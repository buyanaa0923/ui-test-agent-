import { createServer } from '../../mcp/server.mjs';

export default {
  name: 'mcp',
  summary: 'Run the MCP server (stdio) so Claude Code and other agents can call Mole as tools',
  usage: 'mole mcp',
  positionals: 0,
  options: {},
  async run() {
    console.log = console.error; // stdout is the protocol channel: nothing else may write to it
    console.info = console.error;
    // Loaded only when a tool call asks to watch, so headless calls stay lean.
    await createServer({ overlay: async () => (await import('../../ui/overlay/index.mjs')).attachOverlay });
    return 0;
  },
};
