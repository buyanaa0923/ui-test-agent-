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
    await createServer();
    return 0;
  },
};
