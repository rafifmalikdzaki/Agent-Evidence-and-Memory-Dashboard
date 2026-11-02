/**
 * /api/v1/projects/* — Panel REST API (slice 2).
 *
 * REST verbs under the Panel `/api/v1` mount. Auth/session reuse:
 * `validatePanelMetaHeaders` (X-Tdai-Service-Id + X-Tdai-User-Key, or IdP
 * session cookie) + `resolveCallerUserId` (auth/verify) from knowledge
 * common helpers. Responses use the shared envelope helpers
 * (`okEnvelope` / `respondEnvelope` / `respondControlError`); bodies are
 * validated with zod (same library as config/instance-registry).
 *
 * Storage is the Panel-local ProjectStore (see projects/store.ts), which
 * mirrors the MemoryCore slice-1 domain until a kernel project API exists.
 * Project-scoped routes require project membership (creator is auto-owner).
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { PanelDeps } from '../../panel-deps.js';
import { validatePanelMetaHeaders } from '../middleware/validate-panel-headers.js';
import { respondControlError, respondEnvelope } from '../envelope.js';
import { buildCtx, okEnvelope, readJson, resolveCallerUserId } from './knowledge/common.js';
import { ProjectError, ProjectStore, toProvenance, type Provenance } from '../../projects/store.js';

const provShape = {
  author_type: z.enum(['human', 'agent']).optional(),
  model: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
};
const createProjectSchema = z.object({
  team_id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().nullable().optional(),
  metadata_json: z.string().optional(),
  ...provShape,
});
const createThreadSchema = z.object({ title: z.string().trim().min(1).max(200), ...provShape });
const postMessageSchema = z.object({
  body: z.string().trim().min(1),
  thread_id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  ...provShape,
});
const createEvidenceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['file', 'url', 'log', 'screenshot', 'note', 'other']).optional(),
  uri: z.string().nullable().optional(),
  content_ref: z.string().nullable().optional(),
  task_ref: z.string().nullable().optional(),
  ...provShape,
});
const createFindingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().nullable().optional(),
  evidence_id: z.string().nullable().optional(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
  ...provShape,
});
const createBoardSchema = z.object({ name: z.string().trim().min(1).max(200), ...provShape });
const createColumnSchema = z.object({ name: z.string().trim().min(1).max(200), position: z.number().int().min(0).optional() });
const createTaskSchema = z.object({
  column_id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().nullable().optional(),
  assignee_id: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
  ...provShape,
});
const moveTaskSchema = z.object({ column_id: z.string().trim().min(1), position: z.number().int().min(0).optional() });
const toggleSkillSchema = z.object({
  skill_id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean(),
  ...provShape,
});

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };
function parse<T>(c: Context, schema: z.ZodType<T>, body: unknown): ParseResult<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    return { ok: false, response: respondControlError(c, 400, `VALIDATION: ${msg}`) };
  }
  return { ok: true, data: r.data };
}

function handleProjectError(c: Context, err: unknown): Response {
  if (err instanceof ProjectError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 400;
    return respondControlError(c, status, err.message.toUpperCase().replace(/\s+/g, '_').slice(0, 80));
  }
  throw err;
}

export function registerProjectRoutes(api: Hono, deps: PanelDeps, store: ProjectStore = new ProjectStore()): void {
  const mw = validatePanelMetaHeaders(deps);

  async function caller(c: Context): Promise<{ userId: string; provenance: Provenance } | { error: Response }> {
    const panelMeta = c.get('panelMeta');
    const userId = panelMeta?.userId ?? (await resolveCallerUserId(deps, buildCtx(c)));
    if (!userId) return { error: respondControlError(c, 401, 'INVALID_USER_KEY') };
    return { userId, provenance: toProvenance({ author_id: userId }) };
  }
  function provFor(userId: string, body: Record<string, unknown>): Provenance {
    return toProvenance({
      author_id: userId,
      author_type: body.author_type === 'agent' ? 'agent' : body.author_type === 'human' ? 'human' : undefined,
      model: typeof body.model === 'string' ? body.model : null,
      session_id: typeof body.session_id === 'string' ? body.session_id : null,
    });
  }
  async function memberProject(c: Context, projectId: string): Promise<{ userId: string; provenance: Provenance } | { error: Response }> {
    const who = await caller(c);
    if ('error' in who) return who;
    try {
      store.getProject(projectId);
      store.assertMember(projectId, who.userId);
    } catch (err) {
      return { error: handleProjectError(c, err) };
    }
    return who;
  }

  // ── Projects: create / list / get ──────────────────────────────
  api.post('/projects', mw, async (c) => {
    const who = await caller(c);
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createProjectSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      const project = store.createProject({
        team_id: parsed.data.team_id, name: parsed.data.name,
        description: parsed.data.description ?? null, metadata_json: parsed.data.metadata_json,
        provenance: provFor(who.userId, body),
      });
      return respondEnvelope(c, okEnvelope(c, project));
    } catch (err) { return handleProjectError(c, err); }
  });

  api.get('/projects', mw, async (c) => {
    const who = await caller(c);
    if ('error' in who) return who.error;
    const teamId = c.req.query('team_id')?.trim();
    if (!teamId) return respondControlError(c, 400, 'MISSING_TEAM_ID');
    return respondEnvelope(c, okEnvelope(c, store.listProjectsByTeam(teamId)));
  });

  api.get('/projects/:id', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    return respondEnvelope(c, okEnvelope(c, store.getProject(c.req.param('id'))));
  });

  // ── Board messages: threads + messages (list/post) ─────────────
  api.get('/projects/:id/threads', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    return respondEnvelope(c, okEnvelope(c, store.listThreads(c.req.param('id'))));
  });
  api.post('/projects/:id/threads', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createThreadSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      return respondEnvelope(c, okEnvelope(c, store.createThread({ project_id: c.req.param('id'), title: parsed.data.title, provenance: provFor(who.userId, body) })));
    } catch (err) { return handleProjectError(c, err); }
  });
  api.get('/projects/:id/threads/:threadId/messages', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    try {
      const thread = store.getThread(c.req.param('threadId'));
      if (thread.project_id !== c.req.param('id')) return respondControlError(c, 404, 'THREAD_NOT_FOUND');
      return respondEnvelope(c, okEnvelope(c, store.listMessages(thread.id)));
    } catch (err) { return handleProjectError(c, err); }
  });
  api.post('/projects/:id/threads/:threadId/messages', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, postMessageSchema.omit({ thread_id: true, title: true }), body);
    if (!parsed.ok) return parsed.response;
    try {
      const thread = store.getThread(c.req.param('threadId'));
      if (thread.project_id !== c.req.param('id')) return respondControlError(c, 404, 'THREAD_NOT_FOUND');
      return respondEnvelope(c, okEnvelope(c, store.postMessage({ thread_id: thread.id, body: parsed.data.body, provenance: provFor(who.userId, body) })));
    } catch (err) { return handleProjectError(c, err); }
  });
  // Flat board-message aliases: no thread_id → default "Board" thread.
  api.get('/projects/:id/board/messages', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const threadId = c.req.query('thread_id')?.trim();
    try {
      if (threadId) return respondEnvelope(c, okEnvelope(c, store.listMessages(threadId)));
      return respondEnvelope(c, okEnvelope(c, store.listProjectMessages(c.req.param('id'))));
    } catch (err) { return handleProjectError(c, err); }
  });
  api.post('/projects/:id/board/messages', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, postMessageSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      let threadId = parsed.data.thread_id;
      if (!threadId) {
        const threads = store.listThreads(c.req.param('id')).items;
        threadId = threads[0]?.id ?? store.createThread({ project_id: c.req.param('id'), title: parsed.data.title ?? 'Board', provenance: provFor(who.userId, body) }).id;
      }
      return respondEnvelope(c, okEnvelope(c, store.postMessage({ thread_id: threadId, body: parsed.data.body, provenance: provFor(who.userId, body) })));
    } catch (err) { return handleProjectError(c, err); }
  });

  // ── Evidence: list / create / search ───────────────────────────
  api.get('/projects/:id/evidence', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    return respondEnvelope(c, okEnvelope(c, store.listEvidence(c.req.param('id'))));
  });
  api.get('/projects/:id/evidence/search', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const q = c.req.query('q') ?? '';
    const kindRaw = c.req.query('kind');
    const kind = kindRaw && ['file', 'url', 'log', 'screenshot', 'note', 'other'].includes(kindRaw)
      ? (kindRaw as 'file' | 'url' | 'log' | 'screenshot' | 'note' | 'other') : undefined;
    return respondEnvelope(c, okEnvelope(c, store.searchEvidence(c.req.param('id'), q, kind)));
  });
  api.post('/projects/:id/evidence', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createEvidenceSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      return respondEnvelope(c, okEnvelope(c, store.createEvidence({
        project_id: c.req.param('id'), title: parsed.data.title, kind: parsed.data.kind,
        uri: parsed.data.uri ?? null, content_ref: parsed.data.content_ref ?? null, task_ref: parsed.data.task_ref ?? null,
        provenance: provFor(who.userId, body),
      })));
    } catch (err) { return handleProjectError(c, err); }
  });

  // ── Findings: list / create ────────────────────────────────────
  api.get('/projects/:id/findings', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const statusRaw = c.req.query('status');
    const severityRaw = c.req.query('severity');
    const status = statusRaw && ['open', 'confirmed', 'dismissed', 'resolved'].includes(statusRaw)
      ? (statusRaw as 'open' | 'confirmed' | 'dismissed' | 'resolved') : undefined;
    const severity = severityRaw && ['info', 'low', 'medium', 'high', 'critical'].includes(severityRaw)
      ? (severityRaw as 'info' | 'low' | 'medium' | 'high' | 'critical') : undefined;
    return respondEnvelope(c, okEnvelope(c, store.listFindings(c.req.param('id'), { status, severity })));
  });
  api.post('/projects/:id/findings', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createFindingSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      return respondEnvelope(c, okEnvelope(c, store.createFinding({
        project_id: c.req.param('id'), title: parsed.data.title, description: parsed.data.description ?? null,
        evidence_id: parsed.data.evidence_id ?? null, severity: parsed.data.severity,
        provenance: provFor(who.userId, body),
      })));
    } catch (err) { return handleProjectError(c, err); }
  });

  // ── Kanban: boards / columns / tasks create + move ─────────────
  api.get('/projects/:id/boards', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    return respondEnvelope(c, okEnvelope(c, store.listBoards(c.req.param('id'))));
  });
  api.post('/projects/:id/boards', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createBoardSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      return respondEnvelope(c, okEnvelope(c, store.createBoard({ project_id: c.req.param('id'), name: parsed.data.name, provenance: provFor(who.userId, body) })));
    } catch (err) { return handleProjectError(c, err); }
  });
  api.get('/projects/:id/boards/:boardId/columns', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    try { return respondEnvelope(c, okEnvelope(c, store.listColumns(c.req.param('boardId')))); }
    catch (err) { return handleProjectError(c, err); }
  });
  api.post('/projects/:id/boards/:boardId/columns', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createColumnSchema, body);
    if (!parsed.ok) return parsed.response;
    try { return respondEnvelope(c, okEnvelope(c, store.createColumn({ board_id: c.req.param('boardId'), name: parsed.data.name, position: parsed.data.position }))); }
    catch (err) { return handleProjectError(c, err); }
  });
  api.get('/projects/:id/boards/:boardId/tasks', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    try { return respondEnvelope(c, okEnvelope(c, store.listBoardTasks(c.req.param('boardId')))); }
    catch (err) { return handleProjectError(c, err); }
  });
  api.post('/projects/:id/boards/:boardId/tasks', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, createTaskSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      return respondEnvelope(c, okEnvelope(c, store.createBoardTask({
        board_id: c.req.param('boardId'), column_id: parsed.data.column_id, title: parsed.data.title,
        description: parsed.data.description ?? null, assignee_id: parsed.data.assignee_id ?? null, position: parsed.data.position,
        provenance: provFor(who.userId, body),
      })));
    } catch (err) { return handleProjectError(c, err); }
  });
  api.post('/projects/:id/boards/:boardId/tasks/:taskId/move', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, moveTaskSchema, body);
    if (!parsed.ok) return parsed.response;
    try { return respondEnvelope(c, okEnvelope(c, store.moveBoardTask(c.req.param('taskId'), parsed.data.column_id, parsed.data.position))); }
    catch (err) { return handleProjectError(c, err); }
  });

  // ── Project skills: list / toggle (personalized, project-scoped) ─
  api.get('/projects/:id/skills', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const enabledOnly = c.req.query('enabled') === 'true';
    return respondEnvelope(c, okEnvelope(c, store.listSkills(c.req.param('id'), enabledOnly)));
  });
  // Bounded agent context: project + enabled skills only (slice 5).
  api.get('/projects/:id/context', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const id = c.req.param('id');
    const skillCtx = store.getSkillContext(id);
    return respondEnvelope(c, okEnvelope(c, {
      project: store.getProject(id),
      enabled_skills: skillCtx.skills, total_enabled: skillCtx.total_enabled,
      skills_truncated: skillCtx.truncated, skill_context: skillCtx.context_text,
      threads: store.listThreads(id), boards: store.listBoards(id),
    }));
  });
  // SSE live stream: agent/human writes appear without refresh (slice 5).
  // Auth/membership checked before streaming; telemetry is reused via the
  // apiCallTelemetryMiddleware mounted on the api sub-app in app.ts (it
  // records this GET on stream open, same as other /api/v1 calls).
  api.get('/projects/:id/stream', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const id = c.req.param('id');
    const enc = new TextEncoder();
    let unsub = () => {}; let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => { try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* closed */ } };
        unsub = store.subscribe(id, (ev) => send(ev.type, ev));
        send('ready', { type: 'ready', project_id: id, at: new Date().toISOString() });
        heartbeat = setInterval(() => send('ping', { type: 'ping', project_id: id, at: new Date().toISOString() }), 15000);
        (heartbeat as unknown as { unref?: () => void }).unref?.();
      },
      cancel() { unsub(); if (heartbeat) clearInterval(heartbeat); },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
  });
  api.post('/projects/:id/skills/toggle', mw, async (c) => {
    const who = await memberProject(c, c.req.param('id'));
    if ('error' in who) return who.error;
    const body = await readJson(c);
    const parsed = parse(c, toggleSkillSchema, body);
    if (!parsed.ok) return parsed.response;
    try {
      const skill = store.toggleSkill(c.req.param('id'), parsed.data.skill_id, parsed.data.enabled,
        parsed.data.name ? { name: parsed.data.name, provenance: provFor(who.userId, body) } : undefined);
      return respondEnvelope(c, okEnvelope(c, skill));
    } catch (err) { return handleProjectError(c, err); }
  });
}
