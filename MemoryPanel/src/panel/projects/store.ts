/**
 * Panel-local project store (slice 2).
 *
 * Mirrors MemoryCore `metadata/project` domain (slice 1) semantics —
 * validation, creator auto-owner, provenance, kanban ordering and
 * column-name status inference — but lives in Panel because Panel has no
 * kernel `/v3/project/*` surface to proxy to yet. Storage is in-memory;
 * swap the Map backing for the Core SqliteProjectRepository when a
 * kernel project API lands, without changing route shapes.
 */
import { randomBytes } from 'node:crypto';

/** Crockford-base32 ULID (26 char, time + 80-bit CSPRNG) — same scheme as MemoryCore slice 1, no extra dependency. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateUlid(): string {
  const time = Date.now();
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) { out = CROCKFORD[t % 32] + out; t = Math.floor(t / 32); }
  const rand = randomBytes(16);
  for (let i = 0; i < 16; i++) out += CROCKFORD[rand[i]! % 32];
  return out;
}
const ulid = generateUlid;

export type AuthorType = 'human' | 'agent';
export type ProjectStatus = 'active' | 'archived';
export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer';
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type FindingStatus = 'open' | 'confirmed' | 'dismissed' | 'resolved';
export type EvidenceKind = 'file' | 'url' | 'log' | 'screenshot' | 'note' | 'other';
export type BoardTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

export interface Provenance { author_type: AuthorType; author_id: string; model: string | null; session_id: string | null }
interface Base { id: string; created_at: string; updated_at: string }
export interface Project extends Base, Provenance { team_id: string; name: string; description: string | null; status: ProjectStatus; metadata_json: string }
export interface ProjectMember extends Base { project_id: string; user_id: string; role: ProjectRole; status: 'active' | 'removed' }
export interface Thread extends Base, Provenance { project_id: string; title: string }
export interface Message extends Base, Provenance { thread_id: string; project_id: string; body: string }
export interface EvidenceItem extends Base, Provenance { project_id: string; title: string; kind: EvidenceKind; uri: string | null; content_ref: string | null; task_ref: string | null }
export interface Finding extends Base, Provenance { project_id: string; evidence_id: string | null; title: string; description: string | null; severity: FindingSeverity; status: FindingStatus }
export interface Board extends Base, Provenance { project_id: string; name: string }
export interface BoardColumn extends Base { board_id: string; project_id: string; name: string; position: number }
export interface BoardTask extends Base, Provenance { board_id: string; column_id: string; project_id: string; title: string; description: string | null; status: BoardTaskStatus; assignee_id: string | null; position: number }
export interface ProjectSkill extends Base, Provenance { project_id: string; skill_id: string; name: string; enabled: boolean }
export interface ListPage<T> { items: T[]; total: number }
export interface ProjectEvent { type: string; project_id: string; at: string; data: unknown }
export type ProjectEventListener = (e: ProjectEvent) => void;
export const SKILL_CONTEXT_MAX_SKILLS = 20;
export const SKILL_CONTEXT_MAX_CHARS = 4000;
export interface SkillContext { skills: ProjectSkill[]; total_enabled: number; truncated: boolean; context_text: string }

export class ProjectError extends Error {
  constructor(public code: 'not_found' | 'validation' | 'conflict' | 'forbidden', msg: string) {
    super(msg); this.name = 'ProjectError';
  }
}

const now = () => new Date().toISOString();
const req = (v: string | undefined | null, f: string): string => {
  if (!v?.trim()) throw new ProjectError('validation', `${f} required`);
  return v.trim();
};
export function toProvenance(p: { author_id: string; author_type?: AuthorType; model?: string | null; session_id?: string | null }): Provenance {
  if (p.author_type && p.author_type !== 'human' && p.author_type !== 'agent') {
    throw new ProjectError('validation', 'author_type must be human|agent');
  }
  return { author_type: p.author_type ?? 'human', author_id: req(p.author_id, 'author_id'), model: p.model ?? null, session_id: p.session_id ?? null };
}
const page = <T>(items: T[]): ListPage<T> => ({ items, total: items.length });

export class ProjectStore {
  private projects = new Map<string, Project>();
  private members = new Map<string, ProjectMember>();
  private threads = new Map<string, Thread>();
  private messages = new Map<string, Message>();
  private evidence = new Map<string, EvidenceItem>();
  private findings = new Map<string, Finding>();
  private boards = new Map<string, Board>();
  private columns = new Map<string, BoardColumn>();
  private tasks = new Map<string, BoardTask>();
  private skills = new Map<string, ProjectSkill>();
  private listeners = new Map<string, Set<ProjectEventListener>>();
  subscribe(projectId: string, fn: ProjectEventListener): () => void {
    this.mustProject(projectId);
    let set = this.listeners.get(projectId); if (!set) { set = new Set(); this.listeners.set(projectId, set); }
    set.add(fn); return () => { set.delete(fn); if (set.size === 0) this.listeners.delete(projectId); };
  }
  listenerCount(projectId: string): number { return this.listeners.get(projectId)?.size ?? 0; }
  private emit(type: string, projectId: string, data: unknown): void {
    const ev: ProjectEvent = { type, project_id: projectId, at: now(), data };
    for (const fn of [...(this.listeners.get(projectId) ?? [])]) { try { fn(ev); } catch { /* listener errors never break writes */ } }
  }
  private mustProject(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw new ProjectError('not_found', `project not found: ${id}`);
    return p;
  }
  assertMember(projectId: string, userId: string): void {
    const ok = [...this.members.values()].some((m) => m.project_id === projectId && m.user_id === userId && m.status === 'active');
    if (!ok) throw new ProjectError('forbidden', `user ${userId} is not a project member`);
  }
  createProject(i: { team_id: string; name: string; description?: string | null; metadata_json?: string; provenance: Provenance }): Project {
    req(i.team_id, 'team_id'); req(i.name, 'name');
    const t = now();
    const e: Project = { id: ulid(), team_id: i.team_id, name: i.name.trim(), description: i.description ?? null, status: 'active', metadata_json: i.metadata_json ?? '{}', ...i.provenance, created_at: t, updated_at: t };
    this.projects.set(e.id, e);
    const m: ProjectMember = { id: ulid(), project_id: e.id, user_id: i.provenance.author_id, role: 'owner', status: 'active', created_at: t, updated_at: t };
    this.members.set(m.id, m);
    return e;
  }
  getProject(id: string): Project { return this.mustProject(id); }
  listProjectsByTeam(teamId: string): ListPage<Project> {
    return page([...this.projects.values()].filter((p) => p.team_id === teamId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  listMembers(projectId: string): ListPage<ProjectMember> {
    this.mustProject(projectId);
    return page([...this.members.values()].filter((m) => m.project_id === projectId && m.status === 'active'));
  }
  createThread(i: { project_id: string; title: string; provenance: Provenance }): Thread {
    this.mustProject(i.project_id);
    const t = now();
    const e: Thread = { id: ulid(), project_id: i.project_id, title: req(i.title, 'title'), ...i.provenance, created_at: t, updated_at: t };
    this.threads.set(e.id, e); return e;
  }
  listThreads(projectId: string): ListPage<Thread> {
    this.mustProject(projectId);
    return page([...this.threads.values()].filter((x) => x.project_id === projectId));
  }
  getThread(id: string): Thread {
    const th = this.threads.get(id);
    if (!th) throw new ProjectError('not_found', `thread not found: ${id}`);
    return th;
  }
  postMessage(i: { thread_id: string; body: string; provenance: Provenance }): Message {
    const th = this.getThread(i.thread_id);
    const t = now();
    const e: Message = { id: ulid(), thread_id: i.thread_id, project_id: th.project_id, body: req(i.body, 'body'), ...i.provenance, created_at: t, updated_at: t };
    this.messages.set(e.id, e); this.emit('message.created', th.project_id, e); return e;
  }
  listMessages(threadId: string): ListPage<Message> {
    this.getThread(threadId);
    return page([...this.messages.values()].filter((m) => m.thread_id === threadId).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  }
  listProjectMessages(projectId: string): ListPage<Message> {
    this.mustProject(projectId);
    return page([...this.messages.values()].filter((m) => m.project_id === projectId).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  }
  createEvidence(i: { project_id: string; title: string; kind?: EvidenceKind; uri?: string | null; content_ref?: string | null; task_ref?: string | null; provenance: Provenance }): EvidenceItem {
    this.mustProject(i.project_id);
    const t = now();
    const e: EvidenceItem = { id: ulid(), project_id: i.project_id, title: req(i.title, 'title'), kind: i.kind ?? 'note', uri: i.uri ?? null, content_ref: i.content_ref ?? null, task_ref: i.task_ref ?? null, ...i.provenance, created_at: t, updated_at: t };
    this.evidence.set(e.id, e); this.emit('evidence.created', i.project_id, e); return e;
  }
  listEvidence(projectId: string): ListPage<EvidenceItem> {
    this.mustProject(projectId);
    return page([...this.evidence.values()].filter((e) => e.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  searchEvidence(projectId: string, q: string, kind?: EvidenceKind): ListPage<EvidenceItem> {
    const needle = q.trim().toLowerCase();
    return page(this.listEvidence(projectId).items.filter((e) =>
      (!kind || e.kind === kind) &&
      (!needle || e.title.toLowerCase().includes(needle) || (e.uri ?? '').toLowerCase().includes(needle) || (e.content_ref ?? '').toLowerCase().includes(needle))));
  }
  createFinding(i: { project_id: string; title: string; description?: string | null; evidence_id?: string | null; severity?: FindingSeverity; provenance: Provenance }): Finding {
    this.mustProject(i.project_id);
    if (i.evidence_id && !this.evidence.has(i.evidence_id)) throw new ProjectError('not_found', `evidence not found: ${i.evidence_id}`);
    const t = now();
    const e: Finding = { id: ulid(), project_id: i.project_id, evidence_id: i.evidence_id ?? null, title: req(i.title, 'title'), description: i.description ?? null, severity: i.severity ?? 'info', status: 'open', ...i.provenance, created_at: t, updated_at: t };
    this.findings.set(e.id, e); this.emit('finding.created', i.project_id, e); return e;
  }
  listFindings(projectId: string, f?: { status?: FindingStatus; severity?: FindingSeverity }): ListPage<Finding> {
    this.mustProject(projectId);
    return page([...this.findings.values()].filter((x) => x.project_id === projectId && (!f?.status || x.status === f.status) && (!f?.severity || x.severity === f.severity)));
  }
  createBoard(i: { project_id: string; name: string; provenance: Provenance }): Board {
    this.mustProject(i.project_id);
    const t = now();
    const e: Board = { id: ulid(), project_id: i.project_id, name: req(i.name, 'name'), ...i.provenance, created_at: t, updated_at: t };
    this.boards.set(e.id, e); return e;
  }
  listBoards(projectId: string): ListPage<Board> {
    this.mustProject(projectId);
    return page([...this.boards.values()].filter((b) => b.project_id === projectId));
  }
  private mustBoard(id: string): Board {
    const b = this.boards.get(id);
    if (!b) throw new ProjectError('not_found', `board not found: ${id}`);
    return b;
  }
  createColumn(i: { board_id: string; name: string; position?: number }): BoardColumn {
    const b = this.mustBoard(i.board_id);
    const cols = this.listColumns(i.board_id).items;
    const t = now();
    const e: BoardColumn = { id: ulid(), board_id: i.board_id, project_id: b.project_id, name: req(i.name, 'name'), position: i.position ?? cols.length, created_at: t, updated_at: t };
    this.columns.set(e.id, e); return e;
  }
  listColumns(boardId: string): ListPage<BoardColumn> {
    this.mustBoard(boardId);
    return page([...this.columns.values()].filter((c) => c.board_id === boardId).sort((a, b) => a.position - b.position));
  }
  createBoardTask(i: { board_id: string; column_id: string; title: string; description?: string | null; assignee_id?: string | null; position?: number; provenance: Provenance }): BoardTask {
    const b = this.mustBoard(i.board_id);
    const col = this.columns.get(i.column_id);
    if (!col || col.board_id !== i.board_id) throw new ProjectError('not_found', `column not found: ${i.column_id}`);
    const sib = [...this.tasks.values()].filter((x) => x.board_id === i.board_id && x.column_id === i.column_id);
    const t = now();
    const e: BoardTask = { id: ulid(), board_id: i.board_id, column_id: i.column_id, project_id: b.project_id, title: req(i.title, 'title'), description: i.description ?? null, status: 'todo', assignee_id: i.assignee_id ?? null, position: i.position ?? sib.length, ...i.provenance, created_at: t, updated_at: t };
    this.tasks.set(e.id, e); this.emit('task.created', b.project_id, e); return e;
  }
  listBoardTasks(boardId: string): ListPage<BoardTask> {
    this.mustBoard(boardId);
    return page([...this.tasks.values()].filter((x) => x.board_id === boardId).sort((a, b) => a.column_id.localeCompare(b.column_id) || a.position - b.position));
  }
  moveBoardTask(taskId: string, columnId: string, position?: number): BoardTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new ProjectError('not_found', `board task not found: ${taskId}`);
    const col = this.columns.get(columnId);
    if (!col || col.board_id !== task.board_id) throw new ProjectError('not_found', `column not found: ${columnId}`);
    const status: BoardTaskStatus = col.name.toLowerCase().includes('done') ? 'done' : col.name.toLowerCase().includes('progress') ? 'in_progress' : task.status;
    const updated: BoardTask = { ...task, column_id: columnId, position: position ?? task.position, status, updated_at: now() };
    this.tasks.set(taskId, updated); this.emit('task.moved', task.project_id, updated); return updated;
  }
  attachSkill(i: { project_id: string; skill_id: string; name: string; provenance: Provenance }): ProjectSkill {
    this.mustProject(i.project_id);
    const existing = [...this.skills.values()].find((s) => s.project_id === i.project_id && s.skill_id === i.skill_id);
    if (existing) throw new ProjectError('conflict', 'skill already attached');
    const t = now();
    const e: ProjectSkill = { id: ulid(), project_id: i.project_id, skill_id: req(i.skill_id, 'skill_id'), name: req(i.name, 'name'), enabled: true, ...i.provenance, created_at: t, updated_at: t };
    this.skills.set(e.id, e); this.emit('skill.toggled', i.project_id, e); return e;
  }
  listSkills(projectId: string, enabledOnly = false): ListPage<ProjectSkill> {
    this.mustProject(projectId);
    return page([...this.skills.values()].filter((s) => s.project_id === projectId && (!enabledOnly || s.enabled)));
  }
  getSkillContext(projectId: string, opts: { maxSkills?: number; maxChars?: number } = {}): SkillContext {
    const maxSkills = Math.max(0, opts.maxSkills ?? SKILL_CONTEXT_MAX_SKILLS);
    const maxChars = Math.max(0, opts.maxChars ?? SKILL_CONTEXT_MAX_CHARS);
    const enabled = this.listSkills(projectId, true).items;
    const skills = enabled.slice(0, maxSkills);
    let text = skills.map((s) => `- ${s.name} (${s.skill_id})`).join('\n');
    let truncated = enabled.length > skills.length;
    if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true; }
    return { skills, total_enabled: enabled.length, truncated, context_text: text };
  }
  toggleSkill(projectId: string, skillId: string, enabled: boolean, fallback?: { name: string; provenance: Provenance }): ProjectSkill {
    this.mustProject(projectId);
    const existing = [...this.skills.values()].find((s) => s.project_id === projectId && s.skill_id === skillId);
    if (existing) {
      const updated: ProjectSkill = { ...existing, enabled, updated_at: now() };
      this.skills.set(existing.id, updated); this.emit('skill.toggled', projectId, updated); return updated;
    }
    if (!fallback) throw new ProjectError('not_found', `skill not attached: ${skillId}`);
    const created = this.attachSkill({ project_id: projectId, skill_id: skillId, name: fallback.name, provenance: fallback.provenance });
    if (!enabled) { const u = { ...created, enabled: false, updated_at: now() }; this.skills.set(u.id, u); this.emit('skill.toggled', projectId, u); return u; }
    return created;
  }
}
