import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../../src/core/paths.mjs';
import { fixture, tmpDir } from '../helpers/cli.mjs';

// A tiny MCP client: newline-delimited JSON-RPC over the server's stdio.
function client() {
  const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'mole.mjs'), 'mcp'], { cwd: ROOT, env: { ...process.env, UTA_NO_DOTENV: '1', MOLE_RUNS_DIR: tmpDir('mole-mcp-runs-'), TYPESAFE_API_KEY: '', ANTHROPIC_API_KEY: '' } });
  const pending = new Map(), notes = []; let buf = '', raw = '';
  p.stdout.on('data', (d) => {
    raw += d; buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else notes.push(m); }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  return { call, notes, raw: () => raw, notify: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'), close: () => new Promise((r) => { p.on('close', r); p.stdin.end(); }) };
}

test('MCP: handshake, tool catalogue, and a real dig through the protocol', async () => {
  const c = client();
  const init = await c.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-06-18'); assert.equal(init.result.serverInfo.name, 'mole');
  assert.match(init.result.instructions, /NOT RUN/);
  c.notify('notifications/initialized');
  assert.deepEqual((await c.call('ping')).result, {});

  const list = (await c.call('tools/list')).result.tools;
  assert.deepEqual(list.map((t) => t.name).sort(), ['mole_doctor', 'mole_dig', 'mole_report', 'mole_tunnel'].sort());
  for (const t of list) { assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 40); assert.ok(t.annotations.title); }
  assert.deepEqual(list.find((t) => t.name === 'mole_dig').inputSchema.required, ['url']);

  const dig = (await c.call('tools/call', { name: 'mole_dig', arguments: { url: fixture('sample.html'), model: 'none' }, _meta: { progressToken: 'p1' } })).result;
  assert.equal(dig.isError, false);
  assert.match(dig.content[0].text, /NUGGETS FOUND/); assert.match(dig.content[0].text, /contrast/);
  const s = dig.structuredContent;
  assert.equal(s.status, 'defects'); assert.equal(s.exitCode, 1); assert.ok(s.nuggets.length > 5 && s.nuggets[0].severity === 'high');
  assert.ok(s.nuggets.every((n) => n.decidedBy === 'rule'), 'no model was configured, so nothing claims a model verdict');
  assert.ok(c.notes.some((n) => n.method === 'notifications/progress' && n.params.progressToken === 'p1'), 'progress streamed');

  const clean = (await c.call('tools/call', { name: 'mole_dig', arguments: { url: fixture('clean.html'), model: 'none' } })).result;
  assert.equal(clean.isError, false); assert.match(clean.content[0].text, /SURFACED/);

  const rep = (await c.call('tools/call', { name: 'mole_report', arguments: {} })).result;
  assert.equal(rep.isError, false); assert.match(rep.content[0].text, /SURFACED/, 'latest run is the clean one');

  assert.doesNotMatch(c.raw().split('\n').filter((l) => l && !l.startsWith('{')).join(''), /./, 'stdout carried only JSON-RPC');
  await c.close();
});

test('MCP: NOT RUN comes back as an error result, never as a pass', async () => {
  const c = client(); await c.call('initialize', { protocolVersion: '2025-06-18' });
  const r = (await c.call('tools/call', { name: 'mole_dig', arguments: { url: 'http://127.0.0.1:9/', model: 'none' } })).result;
  assert.equal(r.isError, true); assert.match(r.content[0].text, /NOT RUN/); assert.doesNotMatch(r.content[0].text, /SURFACED/);
  assert.equal(r.structuredContent.exitCode, 2);
  await c.close();
});

test('MCP: protocol errors are answered, not crashes', async () => {
  const c = client(); await c.call('initialize', {});
  assert.equal((await c.call('nope/method')).error.code, -32601);
  assert.equal((await c.call('tools/call', { name: 'nope' })).error.code, -32602);
  const bad = (await c.call('tools/call', { name: 'mole_report', arguments: { run: '../../etc' } })).result;
  assert.equal(bad.isError, true, 'path traversal in run name is neutralised');
  await c.close();
});

test('MCP: dig takes a design contract and a platform; findings carry their source and a fix', async () => {
  const c = client(); await c.call('initialize', { protocolVersion: '2025-06-18' });
  const schema = (await c.call('tools/list')).result.tools.find((t) => t.name === 'mole_dig').inputSchema.properties;
  for (const p of ['design', 'platform', 'watch', 'record']) assert.ok(schema[p], `mole_dig accepts ${p}`);
  const r = (await c.call('tools/call', { name: 'mole_dig', arguments: { url: fixture('modern.html'), model: 'none', platform: 'mobile', modes: ['light'] } })).result;
  assert.equal(r.structuredContent.contract.platform, 'mobile');
  const zoom = r.structuredContent.nuggets.find((n) => n.rule === 'input-font-zoom');
  assert.equal(zoom.tier, 'practice'); assert.match(zoom.source, /iOS/); assert.match(zoom.fix, /16px/);
  assert.match(r.content[0].text, /Design: Mole test pages \(NetOS\) · mobile/); assert.match(r.content[0].text, /source: .* fix: /);
  assert.match(zoom.location, /^test-pages\/modern\.html:\d+$/); assert.equal(zoom.locationConfidence, 'high');
  assert.match(r.content[0].text, /at: test-pages\/modern\.html:\d+ \(high\)/, 'Claude is told where to fix it');
  await c.close();
});
