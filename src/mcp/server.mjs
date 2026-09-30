// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), no dependencies.
// Implements: initialize, ping, tools/list, tools/call (+ progress notifications while a tool runs).
// stdout carries ONLY protocol messages; anything else the process prints is redirected to stderr.
import readline from 'node:readline';
import { tools, byName } from './tools.mjs';
import { version } from '../core/version.mjs';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function createServer({ input = process.stdin, output = process.stdout } = {}) {
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const reply = (id, result) => send({ id, result });
  const fail = (id, code, message) => send({ id, error: { code, message } });
  let queue = Promise.resolve(); // one tool at a time: a browser run is not re-entrant

  // Human-readable one-liners for the client's progress display, straight from the event stream.
  const say = (e) => {
    switch (e.type) {
      case 'page.loaded': return `loaded ${e.elements} elements`;
      case 'mode.done': return `${e.mode}: ${e.findings} nugget${e.findings === 1 ? '' : 's'} in ${e.elements} elements`;
      case 'decision': return e.kind === 'triage' && e.by ? `${e.by}: ${e.decision}${e.confidence != null ? ` ${Math.round(e.confidence * 100)}%` : ''}` : null;
      case 'control.pick': return `#${e.n} ${e.role} "${e.label}" (${e.by})`;
      case 'run.result': return e.status === 'pass' ? 'surfaced: clean' : e.status === 'defects' ? `nuggets found: ${e.findings}` : 'not run';
      default: return null;
    }
  };

  async function callTool(id, params) {
    const tool = byName.get(params?.name);
    if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
    const token = params?._meta?.progressToken;
    let n = 0;
    const onEvent = token == null ? null : (e) => { const message = say(e); if (message) send({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message } }); };
    try {
      const r = await tool.run(params.arguments || {}, { onEvent });
      reply(id, { content: [{ type: 'text', text: r.text }], structuredContent: r.data ?? undefined, isError: !!r.isError });
    } catch (e) {
      reply(id, { content: [{ type: 'text', text: `${tool.name} failed: ${e.problem || e.message}` }], isError: true });
    }
  }

  function handle(msg) {
    const { id, method, params } = msg;
    if (method === 'initialize') {
      const wanted = params?.protocolVersion;
      return reply(id, { protocolVersion: SUPPORTED.includes(wanted) ? wanted : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'mole', title: 'Mole: digs up UI bugs', version: version() },
        instructions: 'Mole tests web UIs. Use mole_dig on a URL to find design-system defects, mole_tunnel to check that controls work, mole_doctor if a run cannot start. A NOT RUN result means nothing was tested and must be treated as a failure, never as a pass.' });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    if (method === 'tools/call') { queue = queue.then(() => callTool(id, params)); return queue; }
    if (id == null) return; // notifications (initialized, cancelled, ...) need no reply
    return fail(id, -32601, `Method not found: ${method}`);
  }

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
    try { handle(msg); } catch (e) { if (msg.id != null) fail(msg.id, -32603, e.message); }
  });
  return new Promise((resolve) => rl.on('close', () => queue.then(resolve)));
}
