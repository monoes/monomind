import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { StepEvent, RunRecord } from '../workflow/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4242;

interface DashboardServer {
  broadcast(event: StepEvent): void;
  close(): void;
  port: number;
}

let instance: DashboardServer | null = null;

export function getDashboardServer(port = DEFAULT_PORT): DashboardServer {
  if (instance) return instance;

  const recentRuns: RunRecord[] = [];
  const clients = new Set<WebSocket>();
  const htmlPath = join(__dirname, 'ui.html');

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/') {
      try {
        const html = await readFile(htmlPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end('Dashboard UI not found');
      }
      return;
    }
    if (req.method === 'GET' && req.url === '/runs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(recentRuns));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });
  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    // Send recent state on connect
    ws.send(JSON.stringify({ type: 'init', runs: recentRuns }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  httpServer.listen(port);

  instance = {
    port,
    broadcast(event: StepEvent) {
      const msg = JSON.stringify(event);
      for (const client of clients) {
        if (client.readyState === client.OPEN) client.send(msg);
      }
    },
    close() {
      httpServer.close();
      wss.close();
      instance = null;
    },
  };

  return instance;
}
