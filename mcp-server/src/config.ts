/**
 * Config + credentials for the MCP server.
 *
 * The Panel REST API (slice 2) requires `X-Tdai-Service-Id` plus a user key
 * (`X-Tdai-User-Key`). MCP clients send the user key as
 * `Authorization: Bearer <user-key>`; this server forwards it as
 * `X-Tdai-User-Key` and forwards `x-tdai-service-id` verbatim. For stdio
 * (no per-request HTTP headers) credentials fall back to env vars.
 */
export interface PanelCredentials {
  /** Panel instance id → `X-Tdai-Service-Id` header. */
  serviceId?: string;
  /** User key (Bearer token) → `X-Tdai-User-Key` header. */
  userKey?: string;
}

export interface ServerConfig {
  /** Base URL of the Panel/Core REST API, e.g. http://localhost:3000 (no trailing slash). */
  panelBaseUrl: string;
  /** API prefix mounted on the Panel app. */
  apiPrefix: string;
  /** Default credentials (env / CLI); per-request HTTP headers override these. */
  credentials: PanelCredentials;
  transport: 'stdio' | 'http';
  httpPort: number;
  httpHost: string;
  /** MCP endpoint path for Streamable HTTP. */
  httpPath: string;
}

const stripSlash = (u: string) => u.replace(/\/+$/, '');

export function loadConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const http = argv.includes('--http') || env.MCP_TRANSPORT === 'http';
  const portArg = argv.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : Number(env.MCP_HTTP_PORT ?? env.PORT ?? 3333);
  return {
    panelBaseUrl: stripSlash(env.PANEL_BASE_URL ?? env.PANEL_API_URL ?? 'http://127.0.0.1:3000'),
    apiPrefix: stripSlash(env.PANEL_API_PREFIX ?? '/api/v1'),
    credentials: {
      serviceId: env.PANEL_SERVICE_ID ?? env.TDAI_SERVICE_ID ?? undefined,
      userKey: env.PANEL_USER_KEY ?? env.TDAI_USER_KEY ?? env.PANEL_API_TOKEN ?? undefined,
    },
    transport: http ? 'http' : 'stdio',
    httpPort: Number.isFinite(port) && port > 0 ? port : 3333,
    httpHost: env.MCP_HTTP_HOST ?? '127.0.0.1',
    httpPath: env.MCP_HTTP_PATH ?? '/mcp',
  };
}

/** Extract credentials from inbound HTTP headers (Bearer + x-tdai-service-id). */
export function credentialsFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallback: PanelCredentials = {},
): PanelCredentials {
  const get = (name: string): string | undefined => {
    const v = headers[name];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s.trim() ? s.trim() : undefined;
  };
  const auth = get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : undefined;
  return {
    serviceId: get('x-tdai-service-id') ?? fallback.serviceId,
    userKey: bearer || get('x-tdai-user-key') || fallback.userKey,
  };
}
