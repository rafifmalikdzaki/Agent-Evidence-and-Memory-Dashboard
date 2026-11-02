/**
 * MCP tool definitions → Panel REST mapping (slice 2 API, /api/v1):
 *
 *  project_list         GET  /projects?team_id=
 *  project_get_context  GET  /projects/:id (+ threads/boards/skills lists)
 *  board_list_messages  GET  /projects/:id/board/messages[?thread_id=]
 *  board_post_message   POST /projects/:id/board/messages
 *  evidence_create      POST /projects/:id/evidence
 *  evidence_search      GET  /projects/:id/evidence/search?q=&kind=
 *  finding_create       POST /projects/:id/findings
 *  task_create          POST /projects/:id/boards/:boardId/tasks
 *  task_move            POST /projects/:id/boards/:boardId/tasks/:taskId/move
 *  skill_list           GET  /projects/:id/skills[?enabled=true]
 *  skill_toggle         POST /projects/:id/skills/toggle
 *
 * Input schemas mirror the REST zod schemas in
 * MemoryPanel/src/panel/http/routes/projects.ts. Provenance fields
 * (author_type/model/session_id) pass through to the REST body.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PanelApiError, type PanelClient } from './client.js';

const prov = {
  author_type: z.enum(['human', 'agent']).optional().describe('Provenance author type (default human server-side)'),
  model: z.string().nullable().optional().describe('Model id for agent-authored records'),
  session_id: z.string().nullable().optional().describe('Agent session id for provenance'),
};
const id = (label: string) => z.string().trim().min(1).describe(label);

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: { data } as Record<string, unknown> };
}
function fail(err: unknown): CallToolResult {
  const msg = err instanceof PanelApiError ? `Panel API error ${err.status}/${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: msg }], isError: true };
}
type Handler<A> = (args: A) => Promise<unknown>;
function tool<A>(fn: Handler<A>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => { try { return ok(await fn(args)); } catch (err) { return fail(err); } };
}
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const TOOL_NAMES = [
  'project_list', 'project_get_context', 'board_list_messages', 'board_post_message',
  'evidence_create', 'evidence_search', 'finding_create', 'task_create', 'task_move', 'skill_list', 'skill_toggle',
] as const;

export function registerTools(server: McpServer, client: PanelClient): void {
  server.registerTool('project_list', {
    description: 'List projects for a team (GET /api/v1/projects?team_id=).',
    inputSchema: { team_id: id('Team id') },
  }, tool(async ({ team_id }) => client.listProjects(team_id)));

  server.registerTool('project_get_context', {
    description: 'Get bounded agent context for a project: project, threads, boards and ENABLED skills only, with a bounded skill_context text (GET /api/v1/projects/:id/context; server caps 20 skills / 4000 chars). Disabled skills are excluded.',
    inputSchema: { project_id: id('Project id') },
  }, tool(async ({ project_id }) => client.getProjectContext(project_id)));

  server.registerTool('board_list_messages', {
    description: 'List board messages for a project; omit thread_id for all project messages (GET /api/v1/projects/:id/board/messages).',
    inputSchema: { project_id: id('Project id'), thread_id: id('Thread id').optional() },
  }, tool(async ({ project_id, thread_id }) => client.listBoardMessages(project_id, thread_id)));

  server.registerTool('board_post_message', {
    description: 'Post a message to the project board; without thread_id the server uses/creates the default "Board" thread (POST /api/v1/projects/:id/board/messages).',
    inputSchema: { project_id: id('Project id'), body: z.string().trim().min(1).describe('Message body'), thread_id: id('Thread id').optional(), title: z.string().trim().min(1).max(200).optional().describe('Title for a newly created default thread'), ...prov },
  }, tool(async ({ project_id, ...rest }) => client.postBoardMessage(project_id, defined({ ...rest }))));

  server.registerTool('evidence_create', {
    description: 'Create an evidence item on a project (POST /api/v1/projects/:id/evidence).',
    inputSchema: {
      project_id: id('Project id'), title: z.string().trim().min(1).max(200),
      kind: z.enum(['file', 'url', 'log', 'screenshot', 'note', 'other']).optional(),
      uri: z.string().nullable().optional(), content_ref: z.string().nullable().optional(), task_ref: z.string().nullable().optional(), ...prov,
    },
  }, tool(async ({ project_id, ...rest }) => client.createEvidence(project_id, defined({ ...rest }))));

  server.registerTool('evidence_search', {
    description: 'Search project evidence by text query and optional kind (GET /api/v1/projects/:id/evidence/search?q=&kind=).',
    inputSchema: { project_id: id('Project id'), q: z.string().describe('Search text (empty matches all)'), kind: z.enum(['file', 'url', 'log', 'screenshot', 'note', 'other']).optional() },
  }, tool(async ({ project_id, q, kind }) => client.searchEvidence(project_id, q, kind)));

  server.registerTool('finding_create', {
    description: 'Create a finding on a project; evidence_id must reference existing evidence or the API returns 404 (POST /api/v1/projects/:id/findings).',
    inputSchema: {
      project_id: id('Project id'), title: z.string().trim().min(1).max(200),
      description: z.string().nullable().optional(), evidence_id: z.string().nullable().optional(),
      severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(), ...prov,
    },
  }, tool(async ({ project_id, ...rest }) => client.createFinding(project_id, defined({ ...rest }))));

  server.registerTool('task_create', {
    description: 'Create a kanban task in a board column (POST /api/v1/projects/:id/boards/:boardId/tasks).',
    inputSchema: {
      project_id: id('Project id'), board_id: id('Board id'), column_id: id('Column id'),
      title: z.string().trim().min(1).max(200), description: z.string().nullable().optional(),
      assignee_id: z.string().nullable().optional(), position: z.number().int().min(0).optional(), ...prov,
    },
  }, tool(async ({ project_id, board_id, ...rest }) => client.createTask(project_id, board_id, defined({ ...rest }))));

  server.registerTool('task_move', {
    description: 'Move a kanban task to a column/position; Done/In-Progress status is inferred from the column name server-side (POST /api/v1/projects/:id/boards/:boardId/tasks/:taskId/move).',
    inputSchema: { project_id: id('Project id'), board_id: id('Board id'), task_id: id('Task id'), column_id: id('Target column id'), position: z.number().int().min(0).optional() },
  }, tool(async ({ project_id, board_id, task_id, column_id, position }) => client.moveTask(project_id, board_id, task_id, defined({ column_id, position }))));

  server.registerTool('skill_list', {
    description: 'List skills attached to a project with enabled state; enabled_only=true returns only personalized/enabled skills (GET /api/v1/projects/:id/skills[?enabled=true]).',
    inputSchema: { project_id: id('Project id'), enabled_only: z.boolean().optional().describe('Only enabled skills') },
  }, tool(async ({ project_id, enabled_only }) => client.listSkills(project_id, enabled_only ?? false)));

  server.registerTool('skill_toggle', {
    description: 'Enable/disable a skill for this project only (personalized; does not change the global Skill CRUD in /api/v1/skill/*) (POST /api/v1/projects/:id/skills/toggle).',
    inputSchema: { project_id: id('Project id'), skill_id: id('Skill id'), enabled: z.boolean(), name: z.string().trim().min(1).max(200).optional().describe('Required when attaching a not-yet-attached skill'), ...prov },
  }, tool(async ({ project_id, ...rest }) => client.toggleSkill(project_id, defined({ ...rest }))));
}
