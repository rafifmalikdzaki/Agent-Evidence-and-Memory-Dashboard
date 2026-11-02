/** api/projects.ts — Projects REST client (/api/v1/projects), slice 4. */
import { getPanelSession } from '../panelSession';
import { request, ApiError, unwrapEnvelope } from './base';
import type { MetaEnvelope } from './types';

export type AuthorType = 'human' | 'agent';
export interface Provenance { author_type: AuthorType; author_id: string; model: string | null; session_id: string | null }
interface Base { id: string; created_at: string; updated_at: string }
export interface Project extends Base, Provenance { team_id: string; name: string; description: string | null; status: 'active' | 'archived'; metadata_json: string }
export interface Thread extends Base, Provenance { project_id: string; title: string }
export interface Message extends Base, Provenance { thread_id: string; project_id: string; body: string }
export type EvidenceKind = 'file' | 'url' | 'log' | 'screenshot' | 'note' | 'other';
export interface EvidenceItem extends Base, Provenance { project_id: string; title: string; kind: EvidenceKind; uri: string | null; content_ref: string | null; task_ref: string | null }
export interface Finding extends Base, Provenance { project_id: string; evidence_id: string | null; title: string; description: string | null; severity: string; status: 'open' | 'confirmed' | 'dismissed' | 'resolved' }
export interface Board extends Base, Provenance { project_id: string; name: string }
export interface BoardColumn extends Base { board_id: string; project_id: string; name: string; position: number }
export interface BoardTask extends Base, Provenance { board_id: string; column_id: string; project_id: string; title: string; description: string | null; status: string; assignee_id: string | null; position: number }
export interface ProjectSkill extends Base, Provenance { project_id: string; skill_id: string; name: string; enabled: boolean }
export interface ListPage<T> { items: T[]; total: number }

const P = '/api/v1/projects';
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = getPanelSession();
  if (!s) throw new ApiError(401, 'Unauthorized', 'no active panel session');
  const headers: Record<string, string> = { 'X-Tdai-Service-Id': s.instanceId };
  if (s.userKey) headers['X-Tdai-User-Key'] = s.userKey;
  const env = await request<MetaEnvelope<T>>(method, path, body, headers);
  return unwrapEnvelope(env, 'empty projects response');
}
const enc = encodeURIComponent;
export const projectsApi = {
  list: (teamId: string) => call<ListPage<Project>>('GET', `${P}?team_id=${enc(teamId)}`),
  create: (b: { team_id: string; name: string; description?: string | null }) => call<Project>('POST', P, b),
  get: (id: string) => call<Project>('GET', `${P}/${enc(id)}`),
  boardMessages: (id: string) => call<ListPage<Message>>('GET', `${P}/${enc(id)}/board/messages`),
  postBoardMessage: (id: string, b: { body: string; author_type?: AuthorType; model?: string | null }) => call<Message>('POST', `${P}/${enc(id)}/board/messages`, b),
  listEvidence: (id: string) => call<ListPage<EvidenceItem>>('GET', `${P}/${enc(id)}/evidence`),
  searchEvidence: (id: string, q: string, kind?: string) => call<ListPage<EvidenceItem>>('GET', `${P}/${enc(id)}/evidence/search?q=${enc(q)}${kind ? `&kind=${enc(kind)}` : ''}`),
  createEvidence: (id: string, b: { title: string; kind?: EvidenceKind; uri?: string | null; author_type?: AuthorType }) => call<EvidenceItem>('POST', `${P}/${enc(id)}/evidence`, b),
  listFindings: (id: string) => call<ListPage<Finding>>('GET', `${P}/${enc(id)}/findings`),
  createFinding: (id: string, b: { title: string; evidence_id?: string | null; severity?: string; description?: string | null }) => call<Finding>('POST', `${P}/${enc(id)}/findings`, b),
  listBoards: (id: string) => call<ListPage<Board>>('GET', `${P}/${enc(id)}/boards`),
  createBoard: (id: string, name: string) => call<Board>('POST', `${P}/${enc(id)}/boards`, { name }),
  listColumns: (id: string, boardId: string) => call<ListPage<BoardColumn>>('GET', `${P}/${enc(id)}/boards/${enc(boardId)}/columns`),
  createColumn: (id: string, boardId: string, name: string) => call<BoardColumn>('POST', `${P}/${enc(id)}/boards/${enc(boardId)}/columns`, { name }),
  listTasks: (id: string, boardId: string) => call<ListPage<BoardTask>>('GET', `${P}/${enc(id)}/boards/${enc(boardId)}/tasks`),
  createTask: (id: string, boardId: string, b: { column_id: string; title: string; description?: string | null }) => call<BoardTask>('POST', `${P}/${enc(id)}/boards/${enc(boardId)}/tasks`, b),
  moveTask: (id: string, boardId: string, taskId: string, columnId: string) => call<BoardTask>('POST', `${P}/${enc(id)}/boards/${enc(boardId)}/tasks/${enc(taskId)}/move`, { column_id: columnId }),
  listSkills: (id: string, enabledOnly = false) => call<ListPage<ProjectSkill>>('GET', `${P}/${enc(id)}/skills${enabledOnly ? '?enabled=true' : ''}`),
  getContext: (id: string) => call<{ project: Project; enabled_skills: ProjectSkill[]; skill_context: string; skills_truncated: boolean }>('GET', `${P}/${enc(id)}/context`),
  toggleSkill: (id: string, b: { skill_id: string; name?: string; enabled: boolean }) => call<ProjectSkill>('POST', `${P}/${enc(id)}/skills/toggle`, b),
};

/** SSE live stream via fetch (EventSource cannot send panel headers). Returns unsubscribe. */
export function subscribeProjectStream(id: string, onEvent: (type: string, data: unknown) => void): () => void {
  const ctrl = new AbortController();
  (async () => {
    const s = getPanelSession(); if (!s) return;
    const headers: Record<string, string> = { 'X-Tdai-Service-Id': s.instanceId }; if (s.userKey) headers['X-Tdai-User-Key'] = s.userKey;
    const res = await fetch(`${P}/${enc(id)}/stream`, { headers, signal: ctrl.signal });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = chunk.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const dl = chunk.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim();
        if (dl) { try { onEvent(ev, JSON.parse(dl)); } catch { /* ignore */ } } } }
  })().catch(() => { /* aborted / offline: polling fallback is manual reload */ });
  return () => ctrl.abort();
}
