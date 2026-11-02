# Collaborative Hub — Engineering Handover

Status: MVP implemented on branch `feature/custom-implementation` (based on `feat/server_team` at `ecc01a5`). Existing L0–L3 memory, gateway, and Skill CRUD behaviour is unchanged. This document is the single handover source for architecture, contracts, and operations.

## 1. Purpose

A Claude Projects / GPT Projects-style hub for agent teams, framework-agnostic:

- A human creates a **Project** in the dashboard (instructions, members, files).
- Any MCP-compatible agent (Claude, Codex, GPT, custom) reads the Project context and writes back **Findings** and **Evidence** with provenance; the human edits/approves them in the same Project and the agent continues from the updated state.
- The Project is simultaneously a **collaborative memory** (shared context), a **writing hub** (Board messages + Findings drafts), and a **PM/Kanban board** (tasks linked to evidence and threads).
- **Skills are personalized per Project/Agent**: only enabled skills are injected, with a bounded context budget. No vendor lock-in; the MCP server is the agent boundary.

Out of v1 scope: `MemoryKnowledge/` and `MemoryProxy/` (untouched), multi-instance fan-out, and kernel-persisted project storage (see §14).

## 2. Engineering principles applied

- **Contract first.** REST schemas (zod in Panel routes) and MCP tool schemas mirror each other; the Panel envelope `{code, message, request_id, data}` (`code 0` = ok) is the one error contract.
- **Single source of truth.** Dashboard and MCP are two doors to the same project store; neither duplicates storage logic. MCP tools are one REST call each.
- **Reuse over rewrite.** Panel auth (`validatePanelMetaHeaders`, `X-Tdai-Service-Id` + `X-Tdai-User-Key` / IdP cookie), envelope helpers, ULID ids, and existing Hono/React/Zustand patterns are reused. L0–L3 code paths are not modified.
- **Provenance everywhere.** Every content row carries `author_type` (`human`|`agent`), `author_id`, `model`, `session_id` so the UI can style agent output and audits can trace origin.
- **Bounded context.** `project_get_context` returns enabled skills capped server-side (20 skills / 4000 chars, `truncated` flag) so agents never receive unbounded project history.
- **Isolation by construction.** Slice 1 added only new files; slice 2 added a Panel-local store behind an interface so the kernel swap (§14) is a backend change, not an API change.

## 3. System context

```text
Human ──► MemoryPanel/web (React 18 + Vite) ──► MemoryPanel Hono BFF (:3000, /api/v1)
                                                      │  ▲
                                              SSE stream│  │ REST (envelope)
                                                      ▼  │
Agent (any MCP client) ──► mcp-server (stdio | HTTP :3333/mcp) ──┘ (Bearer → X-Tdai-User-Key)
                                                      │
                              ProjectStore (Panel, in-memory v1) ── mirrors ──► MemoryCore
                              SqliteProjectRepository (Core domain, SQLite proj_* tables)
Existing (untouched): MemoryCore Gateway :8420 (L0–L3, Skills, metadata), MemoryKnowledge, MemoryProxy, SDKs
```

Data flow A (human → agent): create Project in `/projects` → `POST /api/v1/projects` → agent calls `project_get_context` → receives instructions + enabled skills + threads/boards → continues work.
Data flow B (agent → human): agent calls `evidence_create` / `finding_create` / `board_post_message` → Panel store emits event → `GET /projects/:id/stream` SSE → Board tab reloads live → human reviews in Evidence/Kanban tabs.

## 4. Components

| Component | Path | Role |
| --- | --- | --- |
| Core domain | `MemoryCore/src/metadata/project/` | Canonical types, repository interface, SQLite repo, service rules (see §5). Not yet wired into the gateway. |
| Panel API + store | `MemoryPanel/src/panel/http/routes/projects.ts`, `MemoryPanel/src/panel/projects/store.ts` | REST under `/api/v1/projects`, membership checks, pub/sub for SSE. Registered via `registerProjectRoutes` in `MemoryPanel/src/panel/http/app.ts`. |
| MCP server | `mcp-server/` | Agent boundary (tools in §7). No storage logic. |
| Dashboard | `MemoryPanel/web/src/pages/ProjectsPage/`, `lib/api/projects.ts`, `stores/projects.ts` | Project list/detail UI (§9). Routes `/projects`, `/projects/:id` in `web/src/routes/index.tsx`. |
| Existing kernel | `MemoryCore/src/gateway/server.ts`, `MemoryPanel/src/panel/http/app.ts` | L0–L3, metadata, Skill proxy; unchanged except the one `registerProjectRoutes` line. |

## 5. Data model (Core domain)

Defined in `MemoryCore/src/metadata/project/types.ts`; persisted by `sqlite-repository.ts` as `proj_*` tables (ULID PKs, `created_at`/`updated_at`, FK `ON DELETE CASCADE`, `UNIQUE(project,user)` / `UNIQUE(project,skill)`). Service rules live in `service.ts` (`ProjectError`: `not_found`|`validation`|`conflict`|`forbidden`).

| Entity | Key fields |
| --- | --- |
| `Project` | `team_id`, `name`, `description`, `status` (`active`\|`archived`), `metadata_json` |
| `ProjectMember` | `project_id`, `user_id`, `role` (`owner`\|`admin`\|`member`\|`viewer`), `status` (`active`\|`removed`); creator auto-`owner` |
| `Thread` / `Message` | `project_id` (+ `thread_id` on Message), `body`; flat Board is a default `Board` thread |
| `EvidenceItem` | `project_id`, `title`, `kind` (`file`\|`url`\|`log`\|`screenshot`\|`note`\|`other`), `uri`, `content_ref`, `task_ref` |
| `Finding` | `project_id`, `evidence_id` (nullable, referentially checked → 404), `severity` (`info`\|`low`\|`medium`\|`high`\|`critical`), `status` (`open`\|`confirmed`\|`dismissed`\|`resolved`) |
| `Board` / `BoardColumn` / `BoardTask` | `board_id`, `column_id`, `position`; task `status` (`todo`\|`in_progress`\|`done`\|`blocked`) inferred on move from column name (Done/In-Progress) |
| `ProjectSkill` | `project_id`, `skill_id`, `name`, `enabled` |

All content entities embed `Provenance`. Ids are Crockford-base32 ULIDs (`ulid.ts`, no new dependency).

## 6. REST API (`/api/v1`, Hono)

All routes require `X-Tdai-Service-Id` plus `X-Tdai-User-Key` or an IdP session cookie; project-scoped routes enforce membership (`403` otherwise). Bodies are zod-validated (`400` on failure). Success uses the Panel envelope; errors map `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/projects` | Create; creator becomes owner. |
| `GET` | `/projects?team_id=` | List by team. |
| `GET` | `/projects/:id` | Get one. |
| `GET` | `/projects/:id/context` | Project + enabled skills + bounded `skill_context` + threads/boards (agent entry point prep). |
| `GET`/`POST` | `/projects/:id/threads`, `/projects/:id/threads/:threadId/messages` | Threaded board. |
| `GET`/`POST` | `/projects/:id/board/messages` | Flat board alias; auto-creates default `Board` thread. |
| `GET`/`POST` | `/projects/:id/evidence` | List / create. |
| `GET` | `/projects/:id/evidence/search?q=&kind=` | Substring search. |
| `GET`/`POST` | `/projects/:id/findings?status=&severity=` | List (filterable) / create (evidence must exist). |
| `GET`/`POST` | `/projects/:id/boards`, `/:boardId/columns`, `/:boardId/tasks` | Kanban structure and cards. |
| `POST` | `/projects/:id/boards/:boardId/tasks/:taskId/move` | Move card (column/position + status inference). |
| `GET` | `/projects/:id/skills?enabled=true` | List attachments; `enabled=true` filters to enabled only. |
| `POST` | `/projects/:id/skills/toggle` | `{skill_id, name?, enabled}` upsert-toggle. |
| `GET` | `/projects/:id/stream` | SSE (see §8). Membership checked before streaming. |

Implementation: `MemoryPanel/src/panel/http/routes/projects.ts` backed by `MemoryPanel/src/panel/projects/store.ts` (in-memory v1, mirrors Core domain semantics).

## 7. MCP server (`mcp-server/`)

Node 22, ESM TypeScript, `@modelcontextprotocol/sdk` 1.32.2 + express + zod. Server identity `agent-evidence-memory` 0.1.0. Build: `cd mcp-server && npm install && npm run build`.

Transports: stdio (default, `npm start`) and Streamable HTTP (`npm run start:http -- --port=3333` → `http://127.0.0.1:3333/mcp`, health at `/healthz`). HTTP creates a fresh server per session (no credential leakage); unauthenticated `initialize` returns `401`.

Auth mapping: `Authorization: Bearer <user-key>` → `X-Tdai-User-Key`; `x-tdai-service-id` forwarded verbatim; env fallback `PANEL_SERVICE_ID` / `PANEL_USER_KEY` for stdio. Panel failures surface as MCP `isError`.

| Tool | REST call |
| --- | --- |
| `project_list` | `GET /projects?team_id=` |
| `project_get_context` | `GET /projects/:id/context` (bounded skills) |
| `board_list_messages`, `board_post_message` | `GET`/`POST /projects/:id/board/messages` |
| `evidence_create`, `evidence_search` | `POST /evidence`, `GET /evidence/search` |
| `finding_create` | `POST /findings` (use singular `evidence_id`; `evidence_ids[]` is ignored — see §14) |
| `task_create`, `task_move` | `POST /boards/:boardId/tasks`, `POST .../tasks/:taskId/move` |
| `skill_list` (`enabled_only`), `skill_toggle` | `GET /skills`, `POST /skills/toggle` |

Client wiring examples (stdio JSON and HTTP JSON with headers) are in `mcp-server/README.md`. Tools: `mcp-server/src/tools.ts`, client `src/client.ts`, config `src/config.ts`, entry `src/index.ts`.

## 8. Realtime (SSE)

`GET /api/v1/projects/:id/stream` emits `ready`, then store events `message.created`, `evidence.created`, `finding.created`, `task.created`, `task.moved`, `skill.toggled`, plus a 15s `ping` heartbeat; unsubscribe and interval cleanup happen on cancel. The route sits under the API sub-app so stream opens are recorded by `apiCallTelemetryMiddleware` like other `/api/v1` calls.

Web uses fetch-based SSE (`subscribeProjectStream()` in `web/src/lib/api/projects.ts`) because `EventSource` cannot send `X-Tdai-*` headers. The Board tab shows a live indicator and reloads on non-`ping` events, so agent writes appear without refresh.

## 9. Dashboard

React 18 + Vite + React Router + Zustand (`MemoryPanel/web`). Entry: `src/main.tsx` → `App.tsx` → `ConsoleLayout`; new routes in `web/src/routes/index.tsx`, menu in `web/src/constants/menu.tsx`.

- `/projects` (`pages/ProjectsPage/index.tsx`): list for the active team + create form.
- `/projects/:id` (`pages/ProjectsPage/ProjectDetail.tsx`): tabs **Overview** (fields, provenance, counts), **Board** (human + agent messages, agent styling, live indicator), **Evidence** (search, provenance table, create; Findings with draft `open` vs approved `confirmed`/`resolved` badges), **Kanban** (create board with Todo/In Progress/Done, add column/task, move with ◀ ▶ buttons), **Skills** (team skill pool merged with project attachments, checkbox toggles, attach-by-id).
- Client: `web/src/lib/api/projects.ts` (`projectsApi` reusing base `request`/`unwrapEnvelope` + panel-session headers); state: `web/src/stores/projects.ts` (`useProjectStore`). The Vite `/api/v1` proxy already targets the Panel backend; no new proxy config was needed.

## 10. Auth and security

- Dashboard: existing Panel session/IdP (`MemoryPanel/src/panel/auth/`); header-injected ingress only when a provider is registered.
- API/MCP: `X-Tdai-Service-Id` selects the instance; `X-Tdai-User-Key` (or MCP `Bearer`) identifies the caller; membership is enforced server-side on every project-scoped route, never trusted from the client.
- Secrets via environment only; never commit `.env`, tokens, or database files. MCP HTTP binds locally by default; put it behind your existing gateway/auth when exposing it.

## 11. Runbook

Prerequisites: Node ≥ 22, npm. Each package is ESM TypeScript.

```bash
# 1. Core domain check (no server needed for v1 Panel path)
cd MemoryCore && npx vitest run src/metadata/project

# 2. Panel backend (Hono)
cd MemoryPanel && npm run dev          # or: npm run typecheck, npm test

# 3. Dashboard
cd MemoryPanel/web && npm run dev      # then open /projects and log in

# 4. MCP (separate terminal)
cd mcp-server && npm install && npm run build
PANEL_BASE_URL=http://127.0.0.1:3000 PANEL_SERVICE_ID=inst-1 PANEL_USER_KEY=key-1 npm start   # stdio
npm run start:http -- --port=3333      # HTTP alternative → /mcp, /healthz
```

Health checks: Panel `/health`; MCP `GET /healthz` → 200; MCP no-auth `initialize` → 401. First manual pass: create a Project in the UI → `project_get_context` via MCP → `evidence_create` + `finding_create` → confirm in Evidence tab → move a Kanban card.

Note: in this environment, in-repo `npm install` for `MemoryPanel`/`web` fails with `EALLOWREMOTE` (lockfiles pin `mirrors.tencent.com`). Verification therefore ran in `/tmp/panelbuild` and `/tmp/webbuild` copies with the registry rewritten to npmjs; repo lockfiles were left untouched. Fix the mirror/registry on your network before a clean install.

## 12. Verification evidence (observed)

| Check | Result |
| --- | --- |
| Core `npx vitest run src/metadata/project` | 6/6 passed (re-run in handover turn: also 6/6) |
| Panel `tsc --noEmit` (sandbox) | Clean |
| Panel `vitest run tests/projects.test.ts tests/projects-slice5.test.ts` (sandbox) | 8/8 passed (5 + 3) |
| MCP `npm run typecheck` | Clean (re-run: clean) |
| MCP `npm test` | 6/6 passed (re-run: 6/6) |
| MCP `npm run build && npm run smoke` | SMOKE PASS, 11 tools |
| Web `npm run build` (sandbox) | Succeeded, 1410 modules (pre-existing chunk warnings only) |
| Black-box (Panel :4399 + real MCP stdio child) | `POST /projects` → `POST /evidence` → MCP `evidence_create`/`finding_create` → API search/list confirmed. `BLACKBOX DONE` |

Not verified: Core has no `tsconfig.json`, so `tsc --noEmit` there is help text, not a typecheck (Core typecheck remains unverified); full MemoryCore/Panel suites were not run (touched-area tests only); in-repo Panel/Web install is blocked by the mirror issue above.

## 13. File index (deliverable)

- Core: `MemoryCore/src/metadata/project/{types,ulid,repository,sqlite-repository,service,index}.ts`, `project.test.ts`
- Panel: `MemoryPanel/src/panel/http/routes/projects.ts`, `src/panel/projects/store.ts`, `src/panel/http/app.ts` (3-line registration), `MemoryPanel/tests/projects.test.ts`, `tests/projects-slice5.test.ts`
- MCP: `mcp-server/src/{config,client,tools,server,index}.ts`, `test/tools.test.ts`, `scripts/smoke.mjs`, `README.md`
- Web: `MemoryPanel/web/src/lib/api/projects.ts`, `web/src/stores/projects.ts`, `web/src/pages/ProjectsPage/`, edits to `routes/index.tsx`, `constants/menu.tsx`, `layouts/ConsoleLayout.tsx`, `i18n/en-US.ts`, `i18n/zh-CN.ts`
- This doc: `docs/COLLABORATIVE-HUB-ARCHITECTURE.md`. Branch: `feature/custom-implementation`; worktree deleted, single checkout. Untracked `AGENTS.md` and `graphify-out/` are session artifacts, not part of the feature.

## 14. Limits and roadmap

1. **Persistence (top priority).** Panel `ProjectStore` is in-memory — a Panel restart loses projects. Migrate to the Core `SqliteProjectRepository` via a kernel `/v3/project/*` surface (or Panel SQLite on the shared file), keeping the REST contract stable. Service mode additionally needs a MongoDB adapter (`validateMetadataStartupConfig` requires `TDAI_METADATA_MONGO_URI` when `deployMode=service`).
2. **Realtime scale.** SSE is single-process with no `Last-Event-ID` replay; only the Board tab live-reloads (Evidence/Kanban/Skills refresh on mount). Add fan-out (shared pub/sub) and per-tab subscriptions before multi-instance deploys.
3. **Minor defects.** MCP `finding_create` ignores `evidence_ids[]` (use singular `evidence_id`); toggling a skill into the disabled state emits a duplicate `skill.toggled` (consumers reload idempotently); Kanban status inference from column name is heuristic.
4. **Untouched surfaces.** `MemoryKnowledge` (Wiki/CodeGraph) and `MemoryProxy` stay out of v1; wiring Wiki/CodeGraph into Evidence is the natural next increment, as is Kanban drag (v1 uses ◀ ▶ buttons).

## 15. Handover checklist

- [ ] Fix npm registry/mirror, then clean-install `MemoryPanel`, `MemoryPanel/web`, `mcp-server` in-repo and re-run §12 checks.
- [ ] Decide the persistence migration owner/date (§14.1) before shared-team rollout.
- [ ] Create a Project, run the §11 manual pass with your agent client config from `mcp-server/README.md`.
- [ ] Leave `AGENTS.md` / `graphify-out/` out of commits unless your team wants them tracked.

