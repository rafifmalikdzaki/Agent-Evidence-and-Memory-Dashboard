import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PanelClient, PanelApiError } from '../src/client.js';
import { createServer, SERVER_NAME } from '../src/server.js';
import { credentialsFromHeaders } from '../src/config.js';
import { TOOL_NAMES } from '../src/tools.js';

/** In-memory fake of the slice-2 Panel REST API (envelope shape). */
function fakePanel() {
  const calls: { method: string; url: string; headers: Record<string, string>; body?: unknown }[] = [];
  const env = (data: unknown, code = 0, message = 'ok') => ({ code, message, request_id: 'req-1', data });
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? 'GET', url: u.pathname + u.search, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const reply = (data: unknown, status = 200, code = 0, message = 'ok') =>
      new Response(JSON.stringify(env(data, code, message)), { status, headers: { 'content-type': 'application/json' } });
    const p = u.pathname;
    if (p === '/api/v1/projects' && init?.method === 'GET') return reply({ items: [{ id: 'p1', team_id: u.searchParams.get('team_id') }], total: 1 });
    if (p === '/api/v1/projects/p1') return reply({ id: 'p1', name: 'Alpha' });
    if (p === '/api/v1/projects/p1/threads') return reply({ items: [], total: 0 });
    if (p === '/api/v1/projects/p1/boards') return reply({ items: [{ id: 'b1' }], total: 1 });
    if (p === '/api/v1/projects/p1/context') return reply({ project: { id: 'p1', name: 'Alpha' }, enabled_skills: [{ skill_id: 's1', enabled: true }], total_enabled: 1, skills_truncated: false, skill_context: '- Review (s1)', threads: { items: [], total: 0 }, boards: { items: [{ id: 'b1' }], total: 1 } });
    if (p === '/api/v1/projects/p1/skills' && init?.method === 'POST') return reply(null, 404, 404, 'NOT_FOUND');
    if (p === '/api/v1/projects/p1/skills/toggle') return reply({ skill_id: (body as {skill_id:string}).skill_id, enabled: (body as {enabled:boolean}).enabled });
    if (p === '/api/v1/projects/p1/skills') return reply({ items: [{ skill_id: 's1', enabled: true }], total: 1 });
    if (p === '/api/v1/projects/p1/board/messages' && init?.method === 'GET') return reply({ items: [{ id: 'm1', body: 'hi' }], total: 1 });
    if (p === '/api/v1/projects/p1/board/messages') return reply({ id: 'm2', body: (body as { body: string }).body });
    if (p === '/api/v1/projects/p1/evidence') return reply({ id: 'e1', title: (body as { title: string }).title });
    if (p === '/api/v1/projects/p1/evidence/search') return reply({ items: [{ id: 'e1' }], total: u.searchParams.get('q') === 'log' ? 1 : 0 });
    if (p === '/api/v1/projects/p1/findings') {
      return (body as { evidence_id?: string }).evidence_id === 'missing'
        ? reply(null, 404, 404, 'EVIDENCE_NOT_FOUND')
        : reply({ id: 'f1', title: (body as { title: string }).title });
    }
    if (p === '/api/v1/projects/p1/boards/b1/tasks') return reply({ id: 't1', title: (body as { title: string }).title, status: 'todo' });
    if (p === '/api/v1/projects/p1/boards/b1/tasks/t1/move') return reply({ id: 't1', column_id: (body as { column_id: string }).column_id, status: 'done' });
    return reply(null, 404, 404, 'NOT_FOUND');
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function connect(fetchFn: typeof fetch) {
  const client = new PanelClient('http://panel.test', '/api/v1', { serviceId: 'inst-1', userKey: 'key-1' }, fetchFn);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer(client).connect(st);
  const mcp = new Client({ name: 'test', version: '0.0.1' });
  await mcp.connect(ct);
  return mcp;
}
const textOf = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { text?: string }[])[0]?.text ?? '';

describe('mcp tools over fake Panel API', () => {
  it('lists all 11 tools and server identity', async () => {
    const mcp = await connect(fakePanel().fetchFn);
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(mcp.getServerVersion()?.name).toBe(SERVER_NAME);
  });

  it('project_list forwards team_id and auth headers, unwraps envelope', async () => {
    const fake = fakePanel();
    const mcp = await connect(fake.fetchFn);
    const r = await mcp.callTool({ name: 'project_list', arguments: { team_id: 'team-1' } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r)).total).toBe(1);
    expect(fake.calls[0]!.url).toBe('/api/v1/projects?team_id=team-1');
    expect(fake.calls[0]!.headers['x-tdai-service-id']).toBe('inst-1');
    expect(fake.calls[0]!.headers['x-tdai-user-key']).toBe('key-1');
    expect(fake.calls[0]!.headers.authorization).toBe('Bearer key-1');
  });

  it('project_get_context aggregates project+threads+boards+skills', async () => {
    const mcp = await connect(fakePanel().fetchFn);
    const r = await mcp.callTool({ name: 'project_get_context', arguments: { project_id: 'p1' } });
    const data = JSON.parse(textOf(r));
    expect(data.project.name).toBe('Alpha');
    expect(data.boards.total).toBe(1);
    expect(data.enabled_skills).toEqual([{ skill_id: 's1', enabled: true }]);
    expect(data.skill_context).toContain('Review');
  });

  it('board post/list, evidence create/search, finding, task create/move, skill list', async () => {
    const mcp = await connect(fakePanel().fetchFn);
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'board_post_message', arguments: { project_id: 'p1', body: 'hello', author_type: 'agent', model: 'm1' } }))).body).toBe('hello');
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'board_list_messages', arguments: { project_id: 'p1' } }))).total).toBe(1);
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'evidence_create', arguments: { project_id: 'p1', title: 'Log', kind: 'log' } }))).id).toBe('e1');
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'evidence_search', arguments: { project_id: 'p1', q: 'log' } }))).total).toBe(1);
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'finding_create', arguments: { project_id: 'p1', title: 'Bug', evidence_id: 'e1' } }))).id).toBe('f1');
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'task_create', arguments: { project_id: 'p1', board_id: 'b1', column_id: 'c1', title: 'T' } }))).status).toBe('todo');
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'task_move', arguments: { project_id: 'p1', board_id: 'b1', task_id: 't1', column_id: 'c2' } }))).status).toBe('done');
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'skill_list', arguments: { project_id: 'p1' } }))).total).toBe(1);
    expect(JSON.parse(textOf(await mcp.callTool({ name: 'skill_toggle', arguments: { project_id: 'p1', skill_id: 's1', enabled: false } }))).enabled).toBe(false);
  });

  it('surfaces Panel errors as isError and rejects missing credentials', async () => {
    const mcp = await connect(fakePanel().fetchFn);
    const r = await mcp.callTool({ name: 'finding_create', arguments: { project_id: 'p1', title: 'x', evidence_id: 'missing' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('EVIDENCE_NOT_FOUND');
    const bare = new PanelClient('http://panel.test', '/api/v1', {}, fakePanel().fetchFn);
    await expect(bare.listProjects('t')).rejects.toBeInstanceOf(PanelApiError);
  });

  it('credentialsFromHeaders maps Bearer + x-tdai-service-id with env fallback', () => {
    expect(credentialsFromHeaders({ authorization: 'Bearer abc', 'x-tdai-service-id': 'inst-9' })).toEqual({ serviceId: 'inst-9', userKey: 'abc' });
    expect(credentialsFromHeaders({}, { serviceId: 'env-inst', userKey: 'env-key' })).toEqual({ serviceId: 'env-inst', userKey: 'env-key' });
  });
});
