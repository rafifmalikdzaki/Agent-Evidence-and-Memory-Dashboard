/** Build an McpServer with all project tools bound to a PanelClient. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PanelClient } from './client.js';
import { registerTools } from './tools.js';

export const SERVER_NAME = 'agent-evidence-memory';
export const SERVER_VERSION = '0.1.0';

export function createServer(client: PanelClient): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, client);
  return server;
}
