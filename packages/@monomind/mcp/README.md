# @monomind/mcp

[![npm version](https://img.shields.io/npm/v/@monomind/mcp.svg?style=flat-square)](https://www.npmjs.com/package/@monomind/mcp)
[![license](https://img.shields.io/npm/l/@monomind/mcp.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Standalone MCP server** — stdio, HTTP, and WebSocket transports with tool registry, resources, prompts, sessions, and connection pooling. Zero `@monomind/*` dependencies.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

## Install

```bash
npm install @monomind/mcp
```

## Quick start

```typescript
import { quickStart, defineTool } from '@monomind/mcp';

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

```typescript
import { createMCPServer } from '@monomind/mcp';

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
import { createToolRegistry, defineTool } from '@monomind/mcp';

const registry = createToolRegistry(logger);

registry.register({
  name: 'calculate',
  description: 'Perform calculations',
  inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
  handler: async ({ expression }) => ({ result: eval(expression) }),
});

const result = await registry.execute('calculate', { expression: '2 + 2' });
```

## Resources & prompts

```typescript
import { createTextResource, definePrompt, textMessage } from '@monomind/mcp';

// Resources
const { resource, handler } = createTextResource('file://readme.txt', 'README', 'Hello!');
server.getResourceRegistry().registerResource(resource, handler);

// Prompts
const prompt = definePrompt('summarize', 'Summarize text', [
  { name: 'text', description: 'Text to summarize', required: true }
], (args) => ({ messages: [textMessage(`Summarize: ${args.text}`)] }));
server.getPromptRegistry().registerPrompt(prompt);
```

## Server API

```typescript
interface IMCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerTool(tool: MCPTool): boolean;
  registerTools(tools: MCPTool[]): { registered: number; failed: string[] };
  getHealthStatus(): Promise<{ healthy: boolean; error?: string }>;
  getMetrics(): MCPServerMetrics;
  getSessions(): MCPSession[];
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

MIT
