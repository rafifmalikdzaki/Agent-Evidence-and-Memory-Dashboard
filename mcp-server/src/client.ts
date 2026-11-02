/**
 * Thin REST client for the Panel/Core project API (slice 2).
 *
 * No storage logic lives here: every method is one REST call to
 * `{panelBaseUrl}{apiPrefix}/projects/*` and unwraps the Panel envelope
 * `{ code, message, request_id, data }` (code 0 = ok). Non-zero codes and
 * non-2xx HTTP statuses become `PanelApiError` so MCP tools can surface
 * them as `isError` results with the Panel message preserved.
 */
import type { PanelCredentials } from './config.js';

export class PanelApiError extends Error {
  constructor(
    public status: number,
    public code: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'PanelApiError';
  }
}

interface Envelope<T> { code: number; message: string; request_id?: string; data: T }

export type FetchFn = typeof fetch;

export class PanelClient {
  constructor(
    private baseUrl: string,
    private apiPrefix: string,
    private credentials: PanelCredentials = {},
    private fetchFn: FetchFn = fetch,
  ) {}

  withCredentials(credentials: PanelCredentials): PanelClient {
    return new PanelClient(this.baseUrl, this.apiPrefix, { ...this.credentials, ...credentials }, this.fetchFn);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { serviceId, userKey } = this.credentials;
    if (!serviceId) throw new PanelApiError(0, 0, 'MISSING_SERVICE_ID: set x-tdai-service-id header or PANEL_SERVICE_ID env');
    if (!userKey) throw new PanelApiError(0, 0, 'MISSING_USER_KEY: set Authorization: Bearer <user-key> or PANEL_USER_KEY env');
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${this.apiPrefix}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-tdai-service-id': serviceId,
          'x-tdai-user-key': userKey,
          authorization: `Bearer ${userKey}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new PanelApiError(0, 0, `PANEL_UNREACHABLE: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await res.text();
    let env: Envelope<T> | null = null;
    try { env = text ? (JSON.parse(text) as Envelope<T>) : null; } catch { /* fall through */ }
    if (!res.ok || !env || env.code !== 0) {
      throw new PanelApiError(res.status, env?.code ?? res.status, env?.message ?? `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, env?.request_id);
    }
    return env.data;
  }

  // ── Projects ──────────────────────────────────────────────────
  listProjects(teamId: string) { return this.request('GET', `/projects?team_id=${encodeURIComponent(teamId)}`); }
  getProject(projectId: string) { return this.request('GET', `/projects/${encURIComponent(projectId)}`); }
  listThreads(projectId: string) { return this.request('GET', `/projects/${encURIComponent(projectId)}/threads`); }
  listBoards(projectId: string) { return this.request('GET', `/projects/${encURIComponent(projectId)}/boards`); }

  // ── Board messages (flat aliases; default thread server-side) ─
  listBoardMessages(projectId: string, threadId?: string) {
    const q = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : '';
    return this.request('GET', `/projects/${encURIComponent(projectId)}/board/messages${q}`);
  }
  postBoardMessage(projectId: string, body: Record<string, unknown>) {
    return this.request('POST', `/projects/${encURIComponent(projectId)}/board/messages`, body);
  }

  // ── Evidence / findings ───────────────────────────────────────
  createEvidence(projectId: string, body: Record<string, unknown>) {
    return this.request('POST', `/projects/${encURIComponent(projectId)}/evidence`, body);
  }
  searchEvidence(projectId: string, q: string, kind?: string) {
    const params = new URLSearchParams({ q });
    if (kind) params.set('kind', kind);
    return this.request('GET', `/projects/${encURIComponent(projectId)}/evidence/search?${params}`);
  }
  createFinding(projectId: string, body: Record<string, unknown>) {
    return this.request('POST', `/projects/${encURIComponent(projectId)}/findings`, body);
  }

  // ── Kanban tasks ──────────────────────────────────────────────
  createTask(projectId: string, boardId: string, body: Record<string, unknown>) {
    return this.request('POST', `/projects/${encURIComponent(projectId)}/boards/${encURIComponent(boardId)}/tasks`, body);
  }
  moveTask(projectId: string, boardId: string, taskId: string, body: Record<string, unknown>) {
    return this.request('POST', `/projects/${encURIComponent(projectId)}/boards/${encURIComponent(boardId)}/tasks/${encURIComponent(taskId)}/move`, body);
  }

  // ── Skills ────────────────────────────────────────────────────
  listSkills(projectId: string, enabledOnly = false) { return this.request('GET', `/projects/${encURIComponent(projectId)}/skills${enabledOnly ? '?enabled=true' : ''}`); }
  toggleSkill(projectId: string, body: Record<string, unknown>) { return this.request('POST', `/projects/${encURIComponent(projectId)}/skills/toggle`, body); }
  getProjectContext(projectId: string) { return this.request('GET', `/projects/${encURIComponent(projectId)}/context`); }
}

const encURIComponent = encodeURIComponent;
