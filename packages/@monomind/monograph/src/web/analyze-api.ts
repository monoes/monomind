import type { Server, IncomingMessage, ServerResponse } from 'http';
import { buildAsync } from '../pipeline/orchestrator.js';
import { countNodes } from '../storage/node-store.js';
import { countEdges } from '../storage/edge-store.js';
import { openDb, closeDb } from '../storage/db.js';
import { resolve, join } from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnalyzeRequest {
  repoPath: string;
  codeOnly?: boolean;
  force?: boolean;
}

export interface AnalyzeProgressEvent {
  type: 'progress' | 'complete' | 'error';
  phase?: string;
  message?: string;
  error?: string;
  nodeCount?: number;
  edgeCount?: number;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sendEvent(res: ServerResponse, event: AnalyzeProgressEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function parseQueryParams(url: string): { repoPath?: string; codeOnly?: boolean; force?: boolean } {
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

async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    'Access-Control-Allow-Origin': '*',
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
    } finally {
      closeDb(db);
    }
  } catch (err) {
    sendEvent(res, { type: 'error', error: `Build failed: ${String(err)}` });
  } finally {
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
export function registerAnalyzeRoute(
  server: Server,
  pathPrefix: string = '/api',
): void {
  const analyzePath = `${pathPrefix}/analyze`;

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    if (pathname === analyzePath && req.method === 'GET') {
      void handleAnalyze(req, res);
    }
  });
}
