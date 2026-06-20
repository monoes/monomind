import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { StepEvent, RunRecord } from '../workflow/types.js';

const _require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = parseInt(process.env['MONOBROWSE_DASHBOARD_PORT'] ?? '4242', 10);
const MAX_RUN_HISTORY = 50;

export interface DashboardServer {
  broadcast(event: StepEvent): void;
  addRunRecord(record: RunRecord): void;
  isStopRequested(runId: string): boolean;
  close(): void;
  port: number;
}

let instance: DashboardServer | null = null;

export function startDashboard(port = DEFAULT_PORT): DashboardServer {
  if (instance) return instance;

  const runHistory: RunRecord[] = [];
  const stopRequests = new Set<string>();
  const clients = new Set<any>(); // WebSocket or SSE response

  // Try to load ws, fall back to SSE
  let WebSocketServer: any = null;
  try {
    const wsModule = _require('ws');
    WebSocketServer = wsModule.WebSocketServer ?? wsModule.Server;
  } catch {
    // ws not available — fall back to SSE
  }

  // ui.html must be copied to dist/ alongside server.js during build
  let uiHtml: string;
  try {
    uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');
  } catch {
    uiHtml = `<!DOCTYPE html><html><head><title>monobrowse dashboard</title></head><body style="background:#0f0f1a;color:#ccc;font-family:system-ui;padding:20px"><h1>monobrowse dashboard</h1><p>Dashboard UI not found. Run the build to include ui.html.</p><script>const es=new EventSource('/events');es.onmessage=e=>console.log(JSON.parse(e.data));</script></body></html>`;
  }

  const server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(uiHtml);
      return;
    }

    if (url === '/runs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runHistory));
      return;
    }

    if (url.startsWith('/stop/') && req.method === 'POST') {
      const runId = url.slice(6);
      stopRequests.add(runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, runId }));
      return;
    }

    if (url === '/events' && (req.method === 'GET' || req.method === 'HEAD') && !WebSocketServer) {
      // SSE endpoint (fallback when ws not available).
      // No CORS header — the dashboard is served from 127.0.0.1:4242 and no cross-origin
      // access is needed. A wildcard ACAO would let any web page subscribe to workflow events.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  if (WebSocketServer) {
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws: any) => {
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'history', runs: runHistory }));
      ws.on('close', () => clients.delete(ws));
    });
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Dashboard port ${port} is already in use. Set MONOBROWSE_DASHBOARD_PORT to use a different port.`);
    } else {
      console.error(`Dashboard server error: ${err.message}`);
    }
    instance = null;
    process.exit(1);
  });

  server.listen(port, '127.0.0.1');

  function broadcast(event: StepEvent): void {
    const msg = JSON.stringify(event);
    for (const client of clients) {
      try {
        if (typeof client.send === 'function') {
          client.send(msg); // WebSocket
        } else {
          client.write(`data: ${msg}\n\n`); // SSE
        }
      } catch {
        clients.delete(client);
      }
    }
  }

  function addRunRecord(record: RunRecord): void {
    const idx = runHistory.findIndex(r => r.id === record.id);
    if (idx >= 0) {
      runHistory[idx] = record;
    } else {
      runHistory.unshift(record);
      if (runHistory.length > MAX_RUN_HISTORY) runHistory.pop();
    }
  }

  function isStopRequested(runId: string): boolean {
    return stopRequests.has(runId);
  }

  function close(): void {
    server.close();
    instance = null;
  }

  instance = { broadcast, addRunRecord, isStopRequested, close, port };
  return instance;
}

export function getDashboard(): DashboardServer | null {
  return instance;
}
