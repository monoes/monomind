import { buildAsync } from '../pipeline/orchestrator.js';
import { countNodes } from '../storage/node-store.js';
import { countEdges } from '../storage/edge-store.js';
import { openDb, closeDb } from '../storage/db.js';
import { resolve, join, sep } from 'path';
// ── SSE helpers ───────────────────────────────────────────────────────────────
function sendEvent(res, event) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
}
function parseQueryParams(url) {
    const parsed = new URL(url, 'http://localhost');
    const repoPath = parsed.searchParams.get('repoPath') ?? undefined;
    const codeOnly = parsed.searchParams.has('codeOnly')
        ? parsed.searchParams.get('codeOnly') !== 'false'
        : undefined;
    const force = parsed.searchParams.has('force')
        ? parsed.searchParams.get('force') !== 'false'
        : undefined;
    return { repoPath, codeOnly, force };
}
// ── Route handler ─────────────────────────────────────────────────────────────
async function handleAnalyze(req, res) {
    const { repoPath, codeOnly, force } = parseQueryParams(req.url ?? '/');
    if (!repoPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'repoPath query parameter is required' }));
        return;
    }
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': 'http://localhost',
    });
    const dbPath = resolve(join(repoPath, '.monomind', 'monograph.db'));
    try {
        await buildAsync(repoPath, {
            codeOnly,
            force,
            onProgress: (p) => {
                sendEvent(res, {
                    type: 'progress',
                    phase: p.phase,
                    message: p.message,
                });
            },
        });
        const db = openDb(dbPath);
        try {
            const nodeCount = countNodes(db);
            const edgeCount = countEdges(db);
            sendEvent(res, { type: 'complete', nodeCount, edgeCount });
        }
        finally {
            closeDb(db);
        }
    }
    catch (err) {
        sendEvent(res, { type: 'error', error: `Build failed: ${String(err)}` });
    }
    finally {
        res.end();
    }
}
// ── Route registration ────────────────────────────────────────────────────────
/**
 * Register the /api/analyze SSE endpoint on an existing HTTP server.
 *
 * GET /api/analyze?repoPath=<path>&codeOnly=<bool>&force=<bool>
 *
 * Responds with Content-Type: text/event-stream
 * Emits:
 *   data: {"type":"progress","phase":"scan","message":"Scanning files..."}\n\n
 *   data: {"type":"complete","nodeCount":123,"edgeCount":456}\n\n
 *   (or on error)
 *   data: {"type":"error","error":"Build failed: ..."}\n\n
 */
export function registerAnalyzeRoute(server, pathPrefix = '/api', 
/** Allowlisted repo root — only this path (and its subdirectories) may be analyzed */
allowedRepoRoot) {
    const analyzePath = `${pathPrefix}/analyze`;
    server.on('request', (req, res) => {
        const url = req.url ?? '/';
        const pathname = url.split('?')[0];
        if (pathname !== analyzePath || req.method !== 'GET')
            return;
        // DNS rebinding protection: reject requests with a non-localhost Host header
        const host = ((req.headers['host'] ?? '').split(':')[0] ?? '').toLowerCase();
        if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden' }));
            return;
        }
        // If an allowedRepoRoot was provided, enforce it before handling
        if (allowedRepoRoot) {
            const { repoPath } = parseQueryParams(url);
            if (repoPath) {
                const resolved = resolve(repoPath);
                const root = resolve(allowedRepoRoot);
                if (resolved !== root && !resolved.startsWith(root + sep)) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'repoPath outside allowed root' }));
                    return;
                }
            }
        }
        void handleAnalyze(req, res);
    });
}
//# sourceMappingURL=analyze-api.js.map