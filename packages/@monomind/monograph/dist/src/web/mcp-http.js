import { createServer } from 'http';
// ── Helpers ───────────────────────────────────────────────────────────────────
function setCorsHeaders(res, corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJson(res, status, data, corsOrigin) {
    const body = JSON.stringify(data);
    setCorsHeaders(res, corsOrigin);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(status);
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}
function parseQueryParams(url) {
    const idx = url.indexOf('?');
    if (idx === -1)
        return {};
    const params = {};
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
export function createMcpHttpServer(config) {
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
    const toolMap = new Map();
    for (const tool of tools) {
        toolMap.set(tool.name, tool);
    }
    let httpServer = null;
    let actualPort = port;
    function handleRequest(req, res) {
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
                let parsed;
                try {
                    parsed = JSON.parse(body);
                }
                catch {
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
                    .catch((err) => sendJson(res, 500, { error: String(err) }, corsOrigin));
            })
                .catch((err) => sendJson(res, 500, { error: String(err) }, corsOrigin));
            return;
        }
        // GET {pathPrefix}/stream
        if (method === 'GET' && pathname === `${pathPrefix}/stream`) {
            const params = parseQueryParams(url);
            const name = params['name'] ?? '';
            let args = {};
            try {
                args = params['args'] ? JSON.parse(params['args']) : {};
            }
            catch {
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
                .catch((err) => {
                res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
            });
            return;
        }
        // 404 for unrecognised routes
        sendJson(res, 404, { error: 'Not found' }, corsOrigin);
    }
    const server = {
        get port() {
            return actualPort;
        },
        get url() {
            return `http://${host}:${actualPort}`;
        },
        start() {
            return new Promise((resolve, reject) => {
                httpServer = createServer(handleRequest);
                httpServer.on('error', reject);
                httpServer.listen(port, host, () => {
                    const addr = httpServer.address();
                    if (typeof addr === 'object' && addr) {
                        actualPort = addr.port;
                    }
                    resolve();
                });
            });
        },
        stop() {
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
//# sourceMappingURL=mcp-http.js.map