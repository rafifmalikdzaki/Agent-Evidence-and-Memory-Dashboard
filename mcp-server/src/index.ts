#!/usr/bin/env node
/**
 * Entry point: stdio (default) or Streamable HTTP (`--http`).
 *
 * stdio: credentials come from env (PANEL_SERVICE_ID / PANEL_USER_KEY).
 * http:  credentials come per-request from `Authorization: Bearer <user-key>`
 *        + `x-tdai-service-id` headers (env values are fallback defaults).
 * A fresh McpServer+transport is created per HTTP session so credentials
 * never leak between callers.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, credentialsFromHeaders } from './config.js';
import { PanelClient } from './client.js';
import { createServer } from './server.js';

const config = loadConfig();
const baseClient = new PanelClient(config.panelBaseUrl, config.apiPrefix, config.credentials);
const log = (...a: unknown[]) => console.error('[mcp-server]', ...a);

if (config.transport === 'stdio') {
  const transport = new StdioServerTransport();
  await createServer(baseClient).connect(transport);
  log(`stdio transport ready (panel=${config.panelBaseUrl}${config.apiPrefix})`);
} else {
  const app = express();
  app.use(express.json());
  app.get('/healthz', (_req, res) => { res.json({ ok: true, panel: config.panelBaseUrl }); });

  const transports = new Map<string, StreamableHTTPServerTransport>();
  app.all(config.httpPath, async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
          res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session; send initialize first' }, id: null });
          return;
        }
        const creds = credentialsFromHeaders(req.headers, config.credentials);
        if (!creds.serviceId || !creds.userKey) {
          res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing Authorization: Bearer <user-key> and/or x-tdai-service-id header' }, id: null });
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => { transports.set(sid, transport!); },
        });
        transport.onclose = () => { if (transport!.sessionId) transports.delete(transport!.sessionId); };
        await createServer(baseClient.withCredentials(creds)).connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log('http error', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });

  app.listen(config.httpPort, config.httpHost, () => {
    log(`Streamable HTTP on http://${config.httpHost}:${config.httpPort}${config.httpPath} (panel=${config.panelBaseUrl}${config.apiPrefix})`);
  });
}
