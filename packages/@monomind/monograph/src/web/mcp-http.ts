import { createServer } from 'http';
import type { Server, IncomingMessage, ServerResponse } from 'http';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface McpHttpConfig {
  port?: number;
  host?: string;
  path?: string;
  corsOrigin?: string;
  tools?: McpTool[];
}

export interface McpHttpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
  readonly url: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setCorsHeaders(res: ServerResponse, corsOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, status: number, data: unknown, corsOrigin: string): void {
  const body = JSON.stringify(data);
  setCorsHeaders(res, corsOrigin);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function parseQueryParams(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  for (const part of url.slice(idx + 1).split('&')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      params[decodeURIComponent(part.slice(0, eqIdx))] = decodeURIComponent(part.slice(eqIdx + 1));
    }
  }
  return params;
}

// ── createMcpHttpServer ───────────────────────────────────────────────────────

/**
 * Create an HTTP server that handles MCP-style JSON-RPC requests.
 * POST {path}/call   — invoke a tool, return JSON result
 * GET  {path}/stream — SSE stream; client sends tool name+args via query params
 * GET  {path}/tools  — list available tools (name + description)
 */
const ALLOWED_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function createMcpHttpServer(config?: McpHttpConfig): McpHttpServer {
  const port = config?.port ?? 3001;
  const requestedHost = config?.host ?? '127.0.0.1';
  // Restrict to loopback to prevent accidental external exposure
  if (!ALLOWED_HOSTS.has(requestedHost)) {
    throw new Error(`createMcpHttpServer: host must be 127.0.0.1, ::1, or localhost — got "${requestedHost}"`);
  }
  const host = requestedHost;
  const pathPrefix = config?.path ?? '/mcp';
  // Default to restrictive CORS; wildcard is a footgun for a localhost-only server
  const corsOrigin = config?.corsOrigin ?? '127.0.0.1';
  const tools = config?.tools ?? [];

  // Build lookup map
  const toolMap = new Map<string, McpTool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  let httpServer: Server | null = null;
  let actualPort = port;

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // OPTIONS preflight
    if (method === 'OPTIONS') {
      setCorsHeaders(res, corsOrigin);
      res.writeHead(204);
      res.end();
      return;
    }

    // Strip query string for routing
    const pathname = url.split('?')[0] ?? '';

    // GET {pathPrefix}/tools
    if (method === 'GET' && pathname === `${pathPrefix}/tools`) {
      const toolList = tools.map((t) => ({ name: t.name, description: t.description }));
      sendJson(res, 200, { tools: toolList }, corsOrigin);
      return;
    }

    // POST {pathPrefix}/call
    if (method === 'POST' && pathname === `${pathPrefix}/call`) {
      readBody(req)
        .then((body) => {
          let parsed: { name: string; arguments: Record<string, unknown> };
          try {
            parsed = JSON.parse(body) as typeof parsed;
          } catch {
            sendJson(res, 400, { error: 'Invalid JSON body' }, corsOrigin);
            return;
          }

          const { name, arguments: args = {} } = parsed;
          const tool = toolMap.get(name);
          if (!tool) {
            sendJson(res, 404, { error: `Tool not found: ${name}` }, corsOrigin);
            return;
          }

          tool
            .handler(args)
            .then((result) => sendJson(res, 200, result, corsOrigin))
            .catch((err: unknown) =>
              sendJson(res, 500, { error: String(err) }, corsOrigin),
            );
        })
        .catch((err: unknown) => sendJson(res, 500, { error: String(err) }, corsOrigin));
      return;
    }

    // GET {pathPrefix}/stream
    if (method === 'GET' && pathname === `${pathPrefix}/stream`) {
      const params = parseQueryParams(url);
      const name = params['name'] ?? '';
      let args: Record<string, unknown> = {};
      try {
        args = params['args'] ? (JSON.parse(params['args']) as Record<string, unknown>) : {};
      } catch {
        // ignore parse errors, use empty args
      }

      const tool = toolMap.get(name);

      setCorsHeaders(res, corsOrigin);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);

      if (!tool) {
        res.write(`data: ${JSON.stringify({ error: `Tool not found: ${name}` })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      tool
        .handler(args)
        .then((result) => {
          res.write(`data: ${JSON.stringify(result)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        })
        .catch((err: unknown) => {
          res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        });
      return;
    }

    // 404 for unrecognised routes
    sendJson(res, 404, { error: 'Not found' }, corsOrigin);
  }

  const server: McpHttpServer = {
    get port() {
      return actualPort;
    },
    get url() {
      return `http://${host}:${actualPort}`;
    },
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer = createServer(handleRequest);
        httpServer.on('error', reject);
        httpServer.listen(port, host, () => {
          const addr = httpServer!.address();
          if (typeof addr === 'object' && addr) {
            actualPort = addr.port;
          }
          resolve();
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        if (!httpServer) {
          resolve();
          return;
        }
        httpServer.close(() => resolve());
        httpServer = null;
      });
    },
  };

  return server;
}
