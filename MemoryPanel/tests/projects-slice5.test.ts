import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerProjectRoutes } from '../src/panel/http/routes/projects.js';
import { ProjectStore } from '../src/panel/projects/store.js';
import type { PanelDeps } from '../src/panel/panel-deps.js';
const HEADERS = { 'X-Tdai-Service-Id': 'inst-1', 'X-Tdai-User-Key': 'key-1', 'Content-Type': 'application/json' };
function makeApp(store = new ProjectStore()) {
  const deps = { instanceRegistry: { resolve: (id: string) => ({ instance_id: id, gateway_endpoint: 'http://gw', api_key: 'k' }) }, auth: { resolveSession: () => null }, config: { auth: { sessionCookieName: 'sess' } },
    metaKernel: { invoke: async (a: string, b: Record<string, unknown>) => a === 'auth/verify' && b.user_key === 'key-1' ? { code: 0, message: 'ok', request_id: '', data: { valid: true, user: { user_id: 'usr-1' } } } : { code: 0, message: 'ok', request_id: '', data: { valid: false } } },
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } } as unknown as PanelDeps;
  const api = new Hono(); api.use('*', async (c, next) => { c.set('reqId' as never, 'req-test' as never); await next(); }); registerProjectRoutes(api, deps, store);
  const app = new Hono(); app.route('/api/v1', api); return { app, store };
}
async function call(app: Hono, m: string, path: string, body?: unknown, headers = HEADERS) { const r = await app.request(path, { method: m, headers, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: (await r.json()) as { data: Record<string, unknown> & { items?: unknown[]; total?: number } } }; }
async function mk(app: Hono) { const p = await call(app, 'POST', '/api/v1/projects', { team_id: 't', name: 'P' }); return (p.json.data as unknown as { id: string }).id; }
describe('slice5 personalized skills + SSE', () => {
  it('enabled filter + bounded context excludes disabled and caps 20/4000', async () => {
    const { app, store } = makeApp(); const pid = await mk(app);
    for (let i = 0; i < 25; i++) await call(app, 'POST', `/api/v1/projects/${pid}/skills/toggle`, { skill_id: `skl-${i}`, name: `Skill ${i}`, enabled: true });
    await call(app, 'POST', `/api/v1/projects/${pid}/skills/toggle`, { skill_id: 'skl-0', enabled: false });
    const en = await call(app, 'GET', `/api/v1/projects/${pid}/skills?enabled=true`); expect(en.json.data.total).toBe(24);
    expect((await call(app, 'GET', `/api/v1/projects/${pid}/skills`)).json.data.total).toBe(25);
    const ctx = await call(app, 'GET', `/api/v1/projects/${pid}/context`); const d = ctx.json.data as unknown as { enabled_skills: unknown[]; total_enabled: number; skills_truncated: boolean; skill_context: string };
    expect(d.total_enabled).toBe(24); expect(d.enabled_skills.length).toBe(20); expect(d.skills_truncated).toBe(true); expect(d.skill_context.length).toBeLessThanOrEqual(4000); expect(d.skill_context).not.toContain('skl-0');
    for (let i = 0; i < 3; i++) store.attachSkill({ project_id: pid, skill_id: `long-${i}`, name: 'L'.repeat(100), provenance: { author_type: 'human', author_id: 'usr-1', model: null, session_id: null } });
    const unit = store.getSkillContext(pid, { maxSkills: 2, maxChars: 10 }); expect(unit.skills.length).toBe(2); expect(unit.context_text.length).toBe(10); expect(unit.truncated).toBe(true);
  });
  it('SSE: ready then agent message.created without polling; auth enforced', async () => {
    const { app, store } = makeApp(); const pid = await mk(app);
    expect((await app.request(`/api/v1/projects/${pid}/stream`, { headers: { 'X-Tdai-Service-Id': 'inst-1', 'X-Tdai-User-Key': 'bad' } })).status).toBe(401);
    expect((await app.request(`/api/v1/projects/nope/stream`, { headers: HEADERS })).status).toBe(404);
    const res = await app.request(`/api/v1/projects/${pid}/stream`, { headers: HEADERS });
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/event-stream'); expect(store.listenerCount(pid)).toBe(1);
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    const nextChunk = async () => { const { value } = await reader.read(); buf += dec.decode(value); };
    await nextChunk(); expect(buf).toContain('event: ready');
    await call(app, 'POST', `/api/v1/projects/${pid}/board/messages`, { body: 'agent write', author_type: 'agent', model: 'm1' });
    // event may arrive in next read
    for (let i = 0; i < 5 && !buf.includes('message.created'); i++) await nextChunk();
    expect(buf).toContain('event: message.created'); expect(buf).toContain('agent write');
    await reader.cancel(); expect(store.listenerCount(pid)).toBe(0);
  });
  it('store emits skill/evidence events to subscribers', async () => {
    const { app, store } = makeApp(); const pid = await mk(app);
    const seen: string[] = []; const un = store.subscribe(pid, (e) => seen.push(e.type));
    await call(app, 'POST', `/api/v1/projects/${pid}/skills/toggle`, { skill_id: 's1', name: 'S', enabled: true });
    await call(app, 'POST', `/api/v1/projects/${pid}/evidence`, { title: 'E' });
    un(); expect(seen).toContain('skill.toggled'); expect(seen).toContain('evidence.created');
  });
});
