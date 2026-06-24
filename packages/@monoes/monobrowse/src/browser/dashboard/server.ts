import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

export interface StepEvent {
  type: string;
  projectDir?: string;
  [key: string]: unknown;
}

export interface RunRecord {
  id: string;
  startedAt: number;
  status: string;
  itemsProcessed?: number;
  [key: string]: unknown;
}

const RUNS_FILE = join(homedir(), '.monomind', 'browse-runs.json');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function loadPersistedRuns(): Promise<RunRecord[]> {
  if (!existsSync(RUNS_FILE)) return [];
  try {
    return JSON.parse(await readFile(RUNS_FILE, 'utf-8')) as RunRecord[];
  } catch { return []; }
}

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
  /** Map from client (WebSocket or SSE response) to the subscribed project dir,
   *  or null if the client subscribed without a ?dir= filter (receives all events). */
  const clientDirs = new Map<any, string | null>();

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
    uiHtml = `<!DOCTYPE html><html><head><title>monobrowse dashboard</title></head><body style="background:#0f0f1a;color:#ccc;font-family:system-ui;padding:20px"><h1>monobrowse dashboard</h1><p>Dashboard UI not found. Run the build to include ui.html.</p><script>let _retryDelay=1000;function connectSSE(){const es=new EventSource('/events');es.onmessage=e=>{console.log(JSON.parse(e.data));_retryDelay=1000;};es.onerror=()=>{es.close();setTimeout(connectSSE,Math.min(_retryDelay*=2,30000));};};connectSSE();</script></body></html>`;
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';

    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(uiHtml);
      return;
    }

    if (url === '/runs' && req.method === 'GET') {
      const persisted = await loadPersistedRuns().catch(() => [] as RunRecord[]);
      const seen = new Set(runHistory.map(r => r.id));
      const merged = [...runHistory, ...persisted.filter(r => !seen.has(r.id))]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_RUN_HISTORY);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(merged));
      return;
    }

    if (url.startsWith('/stop/') && req.method === 'POST') {
      const runId = url.slice(6);
      stopRequests.add(runId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, runId }));
      return;
    }

    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/events' && (req.method === 'GET' || req.method === 'HEAD') && !WebSocketServer) {
      // SSE fallback when ws not available
      const subscribedDir = parsed.searchParams.get('dir') ?? null;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      clientDirs.set(res, subscribedDir);
      const heartbeat = setInterval(() => {
        try { res.write(': keep-alive\n\n'); } catch { clearInterval(heartbeat); }
      }, 30_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        clientDirs.delete(res);
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  if (WebSocketServer) {
    const wss = new WebSocketServer({ server });
    wss.on('connection', async (ws: any, req: any) => {
      const upgradeUrl = req?.url ?? '/ws';
      const upgradeParsed = new URL(upgradeUrl, 'http://localhost');
      const subscribedDir = upgradeParsed.searchParams.get('dir') ?? null;
      clientDirs.set(ws, subscribedDir);
      const persisted = await loadPersistedRuns().catch(() => [] as RunRecord[]);
      const seen = new Set(runHistory.map(r => r.id));
      const merged = [...runHistory, ...persisted.filter(r => !seen.has(r.id))]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, MAX_RUN_HISTORY);
      ws.send(JSON.stringify({ type: 'history', runs: merged }));
      ws.on('close', () => clientDirs.delete(ws));
    });
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Dashboard port ${port} in use — continuing without live dashboard.`);
    } else {
      console.error(`Dashboard server error: ${err.message}`);
    }
    instance = {
      broadcast: () => {},
      addRunRecord: () => {},
      isStopRequested: () => false,
      close: () => {},
      port,
    };
  });

  server.listen(port, '127.0.0.1');

  function broadcast(event: StepEvent): void {
    const msg = JSON.stringify(event);
    for (const [client, subscribedDir] of clientDirs) {
      if (subscribedDir !== null && event.projectDir !== undefined && subscribedDir !== event.projectDir) {
        continue;
      }
      try {
        if (typeof client.send === 'function') {
          client.send(msg);
        } else {
          client.write(`data: ${msg}\n\n`);
        }
      } catch {
        clientDirs.delete(client);
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
    const dir = join(homedir(), '.monomind');
    mkdir(dir, { recursive: true }).then(() =>
      writeFile(RUNS_FILE, JSON.stringify(runHistory, null, 2))
    ).catch(() => {});
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
