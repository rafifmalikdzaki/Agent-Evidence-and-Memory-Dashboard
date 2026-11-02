#!/usr/bin/env node
/**
 * Smoke test (no Panel required): starts a stub Panel API on an ephemeral
 * port, spawns the built stdio MCP server (dist/index.js), then drives it
 * with raw MCP JSON-RPC: initialize → tools/list → project_list /
 * board_post_message / evidence_search. Exits non-zero on any mismatch.
 * Run `npm run build` first (or `npm run smoke` after build).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seen = [];
const stub = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push(`${req.method} ${u.pathname}${u.search} svc=${req.headers['x-tdai-service-id']} key=${req.headers['x-tdai-user-key']}`);
  const reply = (data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 0, message: 'ok', request_id: 'smoke', data })); };
  if (u.pathname === '/api/v1/projects') return reply({ items: [{ id: 'p1' }], total: 1 });
  if (u.pathname === '/api/v1/projects/p1/board/messages' && req.method === 'POST') return reply({ id: 'm1', body: 'posted' });
  if (u.pathname === '/api/v1/projects/p1/evidence/search') return reply({ items: [], total: 0 });
  res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 404, message: 'NOT_FOUND', request_id: 'smoke', data: null }));
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const panelUrl = `http://127.0.0.1:${stub.address().port}`;

const child = spawn(process.execPath, [join(root, 'dist/index.js')], {
  env: { ...process.env, PANEL_BASE_URL: panelUrl, PANEL_SERVICE_ID: 'inst-smoke', PANEL_USER_KEY: 'key-smoke' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
let seq = 0;
const send = (method, params) => new Promise((resolve) => {
  const id = ++seq; pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const textOf = (r) => r.result.content[0].text;
const assert = (cond, label) => { if (!cond) { console.error(`SMOKE FAIL: ${label}`); process.exitCode = 1; } else console.log(`ok - ${label}`); };

try {
  const init = await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0.1.0' } });
  assert(init.result.serverInfo.name === 'agent-evidence-memory', 'initialize returns server name');
  notify('notifications/initialized', {});
  const list = await send('tools/list', {});
  const names = list.result.tools.map((t) => t.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(['board_list_messages', 'board_post_message', 'evidence_create', 'evidence_search', 'finding_create', 'project_get_context', 'project_list', 'skill_list', 'skill_toggle', 'task_create', 'task_move']), `tools/list = 11 tools (${names.join(',')})`);
  const call = await send('tools/call', { name: 'project_list', arguments: { team_id: 'team-1' } });
  assert(JSON.parse(textOf(call)).total === 1, 'project_list via stdio → stub Panel');
  const post = await send('tools/call', { name: 'board_post_message', arguments: { project_id: 'p1', body: 'hi from smoke' } });
  assert(JSON.parse(textOf(post)).id === 'm1', 'board_post_message via stdio → stub Panel');
  assert(seen.every((s) => s.includes('svc=inst-smoke') && s.includes('key=key-smoke')), 'stub saw x-tdai-service-id + user-key headers');
  console.log('SMOKE PASS');
} finally {
  child.kill(); stub.close();
}
