# Collaborative Hub (custom implementation)

Claude Projects / GPT Projects-style workspace for agent teams, framework-agnostic. A human creates a Project in the dashboard, any MCP-compatible agent reads the Project context and writes back Findings and Evidence, and the Project doubles as a writing hub (Board) and a PM/Kanban board. Skills are personalized per Project — only enabled skills are injected, with a bounded context budget. Built on `feature/custom-implementation`; upstream L0–L3 memory, gateway, and Skill CRUD are unchanged.

For the full design (components, data model, API/MCP contracts, realtime, runbook, limits), see [docs/COLLABORATIVE-HUB-ARCHITECTURE.md](./docs/COLLABORATIVE-HUB-ARCHITECTURE.md). For MCP client wiring, see [mcp-server/README.md](./mcp-server/README.md).

## Quick Start

Prerequisites: Node.js ≥ 22, npm.

```bash
# 1. Core domain check (no server needed for the v1 Panel path)
cd MemoryCore && npx vitest run src/metadata/project

# 2. Panel backend
cd MemoryPanel && npm run dev

# 3. Dashboard (new terminal)
cd MemoryPanel/web && npm run dev
#    log in, then open Projects → /projects

# 4. MCP server (separate terminal)
cd mcp-server && npm install && npm run build
PANEL_BASE_URL=http://127.0.0.1:3000 PANEL_SERVICE_ID=inst-1 PANEL_USER_KEY=key-1 npm start
#    or HTTP: npm run start:http -- --port=3333  (→ /mcp, /healthz)
```

First pass: create a Project in the UI → call `project_get_context` from your agent → `evidence_create` + `finding_create` → confirm in the Evidence tab → move a Kanban card.

> Note: Panel/Web `npm install` can fail with `EALLOWREMOTE` while lockfiles pin `mirrors.tencent.com`. Fix the registry/mirror on your network first; verification in this branch ran in sandbox copies (see the architecture doc, §12).

## Commands

| Command | Description |
| --- | --- |
| `cd MemoryCore && npx vitest run src/metadata/project` | Core domain tests |
| `cd MemoryPanel && npm run dev` | Panel backend (Hono, `/api/v1`) |
| `cd MemoryPanel && npm test` | Panel tests (`vitest run`) |
| `cd MemoryPanel && npm run typecheck` | Panel typecheck (`tsc --noEmit`) |
| `cd MemoryPanel/web && npm run dev` | Dashboard (Vite) |
| `cd MemoryPanel/web && npm run build` | Dashboard build (`tsc && vite build`) |
| `cd mcp-server && npm run build` | Build MCP server |
| `cd mcp-server && npm test` | MCP tool tests |
| `cd mcp-server && npm run smoke` | MCP stdio smoke (needs `build` first) |

## Architecture

- **Core domain** — `MemoryCore/src/metadata/project/` (Project, Member, Thread/Message, Evidence, Finding, Board/Column/Task, ProjectSkill with `human|agent` provenance; SQLite `proj_*` tables, ULID ids).
- **Panel API** — `MemoryPanel/src/panel/http/routes/projects.ts` + `src/panel/projects/store.ts` under `/api/v1/projects` (projects, board/messages, evidence/search, findings, kanban move, skills toggle, context, SSE stream). Membership enforced server-side.
- **MCP server** — `mcp-server/` (11 tools: `project_list`, `project_get_context`, `board_list_messages`, `board_post_message`, `evidence_create`, `evidence_search`, `finding_create`, `task_create`, `task_move`, `skill_list`, `skill_toggle`; stdio + Streamable HTTP). Every tool is one Panel REST call.
- **Dashboard** — `MemoryPanel/web/src/pages/ProjectsPage/` (`/projects`, `/projects/:id` with Overview / Board / Evidence / Kanban / Skills tabs; agent writes appear live on Board via SSE).

Known v1 limits: Panel store is in-memory (restart loses Projects — kernel persistence is the next migration), SSE is single-process and Board-tab live only, `MemoryKnowledge`/`MemoryProxy` untouched. Details and roadmap in the architecture doc, §14.

## Contributing

Follow [CONTRIBUTING.md](./CONTRIBUTING.md) (Conventional Commits, module dev notes). Upstream install for the three stock services is in [INSTALL.md](./INSTALL.md); this file covers only the hub additions.
