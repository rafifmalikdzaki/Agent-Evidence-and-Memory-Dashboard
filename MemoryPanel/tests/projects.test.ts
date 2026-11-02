import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerProjectRoutes } from '../src/panel/http/routes/projects.js';
import { ProjectStore } from '../src/panel/projects/store.js';
import type { PanelDeps } from '../src/panel/panel-deps.js';

const HEADERS = { 'X-Tdai-Service-Id': 'inst-1', 'X-Tdai-User-Key': 'key-1', 'Content-Type': 'application/json' };

function makeApp(store = new ProjectStore()) {
  const deps = {
    instanceRegistry: { resolve: (id: string) => ({ instance_id: id, gateway_endpoint: 'http://gw', api_key: 'k' }) },
    auth: { resolveSession: () => null },
    config: { auth: { sessionCookieName: 'sess' } },
    metaKernel: {
      invoke: async (action: string, body: Record<string, unknown>) =>
        action === 'auth/verify' && body.user_key === 'key-1'
          ? { code: 0, message: 'ok', request_id: '', data: { valid: true, user: { user_id: 'usr-1' } } }
          : action === 'auth/verify'
            ? { code: 0, message: 'ok', request_id: '', data: { valid: false } }
            : { code: 0, message: 'ok', request_id: '', data: null },
    },
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
  } as unknown as PanelDeps;
  const api = new Hono();
  // request id shim (production requestLogger sets it)
  api.use('*', async (c, next) => { c.set('reqId' as never, 'req-test' as never); await next(); });
  registerProjectRoutes(api, deps, store);
  const app = new Hono();
  app.route('/api/v1', api);
  return { app, store };
}

async function call(app: Hono, method: string, path: string, body?: unknown, headers: Record<string, string> = HEADERS) {
  const res = await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { code: number; data: Record<string, unknown> & { items?: unknown[] } } };
}

describe('projects REST API', () => {
  it('create → list → get with envelope + auto-owner membership', async () => {
    const { app } = makeApp();
    const created = await call(app, 'POST', '/api/v1/projects', { team_id: 'team-1', name: ' Alpha ' });
    expect(created.status).toBe(200);
    expect(created.json.code).toBe(0);
    const id = (created.json.data as unknown as { id: string }).id;
    expect(id).toBeTruthy();

    const list = await call(app, 'GET', '/api/v1/projects?team_id=team-1');
    expect(list.json.data.total).toBe(1);

    const got = await call(app, 'GET', `/api/v1/projects/${id}`);
    expect((got.json.data as unknown as { name: string }).name).toBe('Alpha');
  });

  it('rejects missing team_id, invalid body, bad key, unknown project', async () => {
    const { app } = makeApp();
    expect((await call(app, 'GET', '/api/v1/projects')).status).toBe(400);
    expect((await call(app, 'POST', '/api/v1/projects', { team_id: 't' })).status).toBe(400);
    const badKey = await call(app, 'GET', '/api/v1/projects?team_id=t', undefined, { 'X-Tdai-Service-Id': 'inst-1', 'X-Tdai-User-Key': 'nope' });
    expect(badKey.status).toBe(401);
    expect((await call(app, 'GET', '/api/v1/projects/does-not-exist')).status).toBe(404);
    expect((await call(app, 'GET', '/api/v1/projects?team_id=t', undefined, { 'X-Tdai-User-Key': 'key-1' })).status).toBe(400);
  });

  it('board messages: default-thread post + thread post/list', async () => {
    const { app } = makeApp();
    const p = await call(app, 'POST', '/api/v1/projects', { team_id: 't', name: 'P' });
    const pid = (p.json.data as unknown as { id: string }).id;
    const msg = await call(app, 'POST', `/api/v1/projects/${pid}/board/messages`, { body: 'hello board' });
    expect(msg.status).toBe(200);
    const listed = await call(app, 'GET', `/api/v1/projects/${pid}/board/messages`);
    expect(listed.json.data.total).toBe(1);

    const th = await call(app, 'POST', `/api/v1/projects/${pid}/threads`, { title: 'Standup' });
    const tid = (th.json.data as unknown as { id: string }).id;
    await call(app, 'POST', `/api/v1/projects/${pid}/threads/${tid}/messages`, { body: 'in thread' });
    const inThread = await call(app, 'GET', `/api/v1/projects/${pid}/threads/${tid}/messages`);
    expect(inThread.json.data.total).toBe(1);
    expect((await call(app, 'POST', `/api/v1/projects/${pid}/board/messages`, { body: ' ' })).status).toBe(400);
  });

  it('evidence create/list/search + findings create/list with referential check', async () => {
    const { app } = makeApp();
    const p = await call(app, 'POST', '/api/v1/projects', { team_id: 't', name: 'P' });
    const pid = (p.json.data as unknown as { id: string }).id;
    const ev = await call(app, 'POST', `/api/v1/projects/${pid}/evidence`, { title: 'Server log', kind: 'log', uri: 'file://x' });
    const evid = (ev.json.data as unknown as { id: string }).id;
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/evidence`)).json.data.total).toBe(1);
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/evidence/search?q=server`)).json.data.total).toBe(1);
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/evidence/search?q=nomatch`)).json.data.total).toBe(0);

    const f = await call(app, 'POST', `/api/v1/projects/${pid}/findings`, { title: 'Bug', evidence_id: evid, severity: 'high' });
    expect(f.status).toBe(200);
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/findings?severity=high`)).json.data.total).toBe(1);
    expect((await call(app, 'POST', `/api/v1/projects/${pid}/findings`, { title: 'x', evidence_id: 'missing' })).status).toBe(404);
  });

  it('kanban columns/tasks create + move infers done status; skills toggle', async () => {
    const { app } = makeApp();
    const p = await call(app, 'POST', '/api/v1/projects', { team_id: 't', name: 'P' });
    const pid = (p.json.data as unknown as { id: string }).id;
    const board = await call(app, 'POST', `/api/v1/projects/${pid}/boards`, { name: 'Sprint' });
    const bid = (board.json.data as unknown as { id: string }).id;
    const c1 = await call(app, 'POST', `/api/v1/projects/${pid}/boards/${bid}/columns`, { name: 'Todo' });
    const c2 = await call(app, 'POST', `/api/v1/projects/${pid}/boards/${bid}/columns`, { name: 'Done' });
    const todoId = (c1.json.data as unknown as { id: string }).id;
    const doneId = (c2.json.data as unknown as { id: string }).id;
    expect((c2.json.data as unknown as { position: number }).position).toBe(1);

    const task = await call(app, 'POST', `/api/v1/projects/${pid}/boards/${bid}/tasks`, { column_id: todoId, title: 'Task1' });
    const taskId = (task.json.data as unknown as { id: string }).id;
    const moved = await call(app, 'POST', `/api/v1/projects/${pid}/boards/${bid}/tasks/${taskId}/move`, { column_id: doneId, position: 0 });
    expect((moved.json.data as unknown as { status: string }).status).toBe('done');
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/boards/${bid}/tasks`)).json.data.total).toBe(1);

    const on = await call(app, 'POST', `/api/v1/projects/${pid}/skills/toggle`, { skill_id: 'skl-1', name: 'Review', enabled: true });
    expect((on.json.data as unknown as { enabled: boolean }).enabled).toBe(true);
    const off = await call(app, 'POST', `/api/v1/projects/${pid}/skills/toggle`, { skill_id: 'skl-1', enabled: false });
    expect((off.json.data as unknown as { enabled: boolean }).enabled).toBe(false);
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/skills`)).json.data.total).toBe(1);
  });
});
