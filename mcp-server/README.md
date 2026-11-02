# Agent Evidence & Memory — MCP Server

MCP server exposing the Agent Evidence & Memory Dashboard project tools to
MCP clients (Claude Code, Codex, Inspector, …). It is a thin adapter: every
tool is one call to the Panel/Core REST API (slice 2, `/api/v1/projects/*`).
No storage logic is duplicated here.

- Runtime: Node ≥ 22, ESM TypeScript (`"type": "module"`)
- SDK: `@modelcontextprotocol/sdk` (McpServer + zod tool schemas)
- Transports: **stdio** (default) and **Streamable HTTP** (`--http`)

## Tools

| Tool | REST call | Required args |
|---|---|---|
| `project_list` | `GET /projects?team_id=` | `team_id` |
| `project_get_context` | `GET /projects/:id` + threads/boards/skills | `project_id` |
| `board_list_messages` | `GET /projects/:id/board/messages` | `project_id` (`thread_id?`) |
| `board_post_message` | `POST /projects/:id/board/messages` | `project_id`, `body` |
| `evidence_create` | `POST /projects/:id/evidence` | `project_id`, `title` |
| `evidence_search` | `GET /projects/:id/evidence/search?q=&kind=` | `project_id`, `q` |
| `finding_create` | `POST /projects/:id/findings` | `project_id`, `title` |
| `task_create` | `POST /projects/:id/boards/:boardId/tasks` | `project_id`, `board_id`, `column_id`, `title` |
| `task_move` | `POST …/tasks/:taskId/move` | `project_id`, `board_id`, `task_id`, `column_id` |
| `skill_list` | `GET /projects/:id/skills` | `project_id` |

Optional provenance fields (`author_type`, `model`, `session_id`) pass
through to the REST body. Panel errors (envelope `code != 0`) are returned
as MCP `isError` results with the Panel message preserved.

## Auth

The Panel API requires `X-Tdai-Service-Id` + a user key. Callers provide:

- `Authorization: Bearer <user-key>` → forwarded as `X-Tdai-User-Key`
- `x-tdai-service-id: <instance-id>` → forwarded verbatim

For stdio (no HTTP headers), set env fallbacks instead:
`PANEL_SERVICE_ID`, `PANEL_USER_KEY`. HTTP per-request headers override env.

## Run

```bash
cd mcp-server
npm install
npm run build

# stdio (for local MCP clients)
PANEL_BASE_URL=http://127.0.0.1:3000 PANEL_SERVICE_ID=inst-1 PANEL_USER_KEY=key-1 npm start

# Streamable HTTP on http://127.0.0.1:3333/mcp  (GET /healthz for liveness)
PANEL_BASE_URL=http://127.0.0.1:3000 npm run start:http -- --port=3333
# dev (no build): npm run dev  |  npm run dev:http
```

Env: `PANEL_BASE_URL` (default `http://127.0.0.1:3000`), `PANEL_API_PREFIX`
(default `/api/v1`), `MCP_TRANSPORT=http`, `MCP_HTTP_PORT`/`--port=`,
`MCP_HTTP_HOST`, `MCP_HTTP_PATH` (default `/mcp`).

## Client config examples

Claude Code / Codex (stdio):

```json
{
  "mcpServers": {
    "agent-evidence-memory": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "PANEL_BASE_URL": "http://127.0.0.1:3000",
        "PANEL_SERVICE_ID": "inst-1",
        "PANEL_USER_KEY": "key-1"
      }
    }
  }
}
```

Streamable HTTP (server started with `--http`):

```json
{
  "mcpServers": {
    "agent-evidence-memory": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer key-1",
        "x-tdai-service-id": "inst-1"
      }
    }
  }
}
```

## Verify

```bash
npm run typecheck   # tsc --noEmit, zero errors
npm test            # vitest: 6 tests over an in-memory fake Panel API
npm run build && npm run smoke   # spawns dist stdio server vs stub Panel: SMOKE PASS
```

Files: `src/config.ts` (env/CLI + header→credential mapping),
`src/client.ts` (envelope-unwrapping REST client, `PanelApiError`),
`src/tools.ts` (9 tool schemas/handlers), `src/server.ts` (McpServer
factory), `src/index.ts` (stdio + Streamable HTTP entry, per-session
credential isolation), `test/tools.test.ts`, `scripts/smoke.mjs`.
