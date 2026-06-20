import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StepEvent, RunRecord } from '../workflow/types.js';

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wsModule = require('ws');
    WebSocketServer = wsModule.WebSocketServer ?? wsModule.Server;
  } catch {
    // ws not available — use SSE
  }

  const uiHtml = readFileSync(join(__dirname, 'ui.html'), 'utf-8');

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

    if (url === '/events' && req.method === 'GET' && !WebSocketServer) {
      // SSE endpoint (fallback when ws not available)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
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

  server.listen(port);

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
