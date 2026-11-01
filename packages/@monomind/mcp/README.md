<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/mcp.png" alt="@monoes/mcp" width="600" />
</p>

# @monoes/mcp

[![npm version](https://img.shields.io/npm/v/@monoes/mcp.svg?style=flat-square)](https://www.npmjs.com/package/@monoes/mcp)
[![license](https://img.shields.io/npm/l/@monoes/mcp.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.12-blue?style=flat-square)](https://nodejs.org)

**Standalone MCP server engine** — Version `2.24.1`. Supports stdio, HTTP, and WebSocket transports with tool registry, resources, prompts, sessions, rate limiting, and connection pooling. Zero `@monomind/*` dependencies.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

---

## Package Architecture & Versioning

The Monomind MCP Subsystem is split across two core packages:

1. **`@monoes/mcp` (`v2.24.1`)** (*This package*): Standalone MCP protocol engine powering stdio, HTTP (Express/Cors/Helmet), and WebSocket (`ws`) transports, connection pooling, prompt/resource registries, rate limiting, and session lifecycle management.
2. **`@monoes/monomindcli` (`v2.29.1`)**: Implements CLI integration, binary entry points (`monomind-mcp`), MCP server manager, MCP client loader, and 30+ domain tool modules (`src/mcp-tools/`).

- **Protocol Version**: The CLI's `initialize` response returns `protocolVersion: '2024-11-05'` ([`packages/@monomind/cli/src/mcp-server.ts`](../cli/src/mcp-server.ts)). This package's `MCPServer` reports MCP `2025-11-25` ([`packages/@monomind/mcp/src/server-core.ts`](src/server-core.ts)).
- **Server Identity Version Drift**: The CLI's `initialize` response hardcodes server identity `serverInfo: { name: 'monomind', version: '3.0.0' }` ([`packages/@monomind/cli/src/mcp-server.ts`](../cli/src/mcp-server.ts)), and this package exports `VERSION = '3.0.0'`; both are decoupled from package versioning (`v2.29.1` / `v2.24.1`).

---

## Server Entry Points

| Entry Point / Module | Location | Description & Role |
|---|---|---|
| **`bin/mcp-server.js`** | `packages/@monomind/cli/bin/mcp-server.js` | Direct stdio MCP server binary (`monomind-mcp`). Reads lines from `process.stdin` and handles JSON-RPC calls (`server/discover`, `initialize`, `tools/list`, `tools/call`, and others) with hardcoded version `3.0.0` protocol handshake behavior for direct Claude Code integration. |
| **`commands/mcp.ts`** | `packages/@monomind/cli/src/commands/mcp.ts` | User-facing CLI command handler for `monomind mcp` subcommands (`start`, `stop`, `status`, `health`, `restart`, `tools`, `toggle`, `exec`, `logs`, `verify`, `monoes-proxy`). |
| **`mcp-server.ts`** | `packages/@monomind/cli/src/mcp-server.ts` | Implements `MCPServerManager` class managing server process lifecycle, PID file management (`~/.monomind/mcp.pid`), background daemonization, and health monitoring. |

---

## Install

```bash
npm install @monoes/mcp
```

## Quick start

```typescript
import { quickStart, defineTool } from '@monoes/mcp';

const server = await quickStart({
  transport: 'stdio',
  name: 'My MCP Server',
});

server.registerTool(defineTool(
  'greet',
  'Greet a user',
  { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  async ({ name }) => ({ message: `Hello, ${name}!` })
));

await server.start();
```

## Transports

> **Note:** Monomind's `monomind-mcp` binary uses direct stdio transport (`bin/mcp-server.js`) for minimal latency with Claude Code. The `@monoes/mcp` package provides full transport modularity (stdio, HTTP, WebSocket) for custom or standalone integrations.

```typescript
import { createMCPServer } from '@monoes/mcp';

// stdio (default — for Claude Code integration)
const server = createMCPServer({ transport: 'stdio', name: 'My Server' }, logger);

// HTTP with auth
const server = createMCPServer({
  transport: 'http',
  host: 'localhost',
  port: 3000,
  corsEnabled: true,
  auth: { enabled: true, method: 'token', tokens: ['secret'] },
}, logger);

// WebSocket
const server = createMCPServer({
  transport: 'websocket',
  host: 'localhost',
  port: 3001,
  maxConnections: 100,
}, logger);
```

## Tool registry

```typescript
import { createToolRegistry, defineTool } from '@monoes/mcp';

const registry = createToolRegistry(logger);

registry.register({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  handler: async ({ a, b }) => ({ result: a + b }),
});

const result = await registry.execute('add', { a: 2, b: 2 });
```

## Resources & prompts

```typescript
import { createTextResource, definePrompt, textMessage } from '@monoes/mcp';

// Resources
const { resource, handler } = createTextResource('file://readme.txt', 'README', 'Hello!');
server.getResourceRegistry().registerResource(resource, handler);

// Prompts
const prompt = definePrompt(
  'summarize',
  'Summarize text',
  async (args) => [textMessage('user', `Summarize: ${args.text}`)],
  { arguments: [{ name: 'text', description: 'Text to summarize', required: true }] }
);
server.getPromptRegistry().registerPrompt(prompt);
```

## Server API

```typescript
interface IMCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerTool(tool: MCPTool): boolean;
  registerTools(tools: MCPTool[]): { registered: number; failed: string[] };
  getHealthStatus(): Promise<{ healthy: boolean; error?: string; metrics?: Record<string, number> }>;
  getMetrics(): MCPServerMetrics;
  getSessions(): MCPSession[];
  getSession(sessionId: string): MCPSession | undefined;
  terminateSession(sessionId: string): boolean;
}
```

## Built-in tools

| Tool | Description |
|------|-------------|
| `system/info` | Server information |
| `system/health` | Health status |
| `system/metrics` | Server metrics |
| `tools/list-detailed` | List all tools with details |

## Links

- [GitHub](https://github.com/monoes/monomind)
- [MCP Specification](https://modelcontextprotocol.io)
- [Issues](https://github.com/monoes/monomind/issues)

## License

Apache-2.0

