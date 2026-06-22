import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import type { StepEvent, RunRecord, PlaybookDef } from '@monoes/monoplaybook';

const RUNS_FILE = join(homedir(), '.monomind', 'browse-runs.json');
const PLAYBOOKS_FILE = join(homedir(), '.monomind', 'playbooks.json');

async function loadPlaybooks(): Promise<PlaybookDef[]> {
  if (!existsSync(PLAYBOOKS_FILE)) return [];
  try {
    return JSON.parse(await readFile(PLAYBOOKS_FILE, 'utf-8')) as PlaybookDef[];
  } catch { return []; }
}

async function savePlaybooks(playbooks: PlaybookDef[]): Promise<void> {
  await mkdir(join(homedir(), '.monomind'), { recursive: true });
  await writeFile(PLAYBOOKS_FILE, JSON.stringify(playbooks, null, 2));
}

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
      // Merge in-memory runs with persisted runs so the UI shows history even across restarts
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

    // Parse the URL to correctly handle query parameters such as ?dir=
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/events' && (req.method === 'GET' || req.method === 'HEAD') && !WebSocketServer) {
      // SSE endpoint (fallback when ws not available).
      // No CORS header — the dashboard is served from 127.0.0.1:4242 and no cross-origin
      // access is needed. A wildcard ACAO would let any web page subscribe to playbook events.
      const subscribedDir = parsed.searchParams.get('dir') ?? null;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      clientDirs.set(res, subscribedDir);
      // 30-second keep-alive heartbeat prevents proxy idle-timeout drops.
      const heartbeat = setInterval(() => {
        try { res.write(': keep-alive\n\n'); } catch { clearInterval(heartbeat); }
      }, 30_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        clientDirs.delete(res);
      });
      return;
    }

    // ── Playbook CRUD ────────────────────────────────────────────────────
    // GET  /api/playbooks          → list all saved playbooks
    // POST /api/playbooks          → create/update a playbook (body: PlaybookDef)
    // GET  /api/playbooks/:id      → get single playbook
    // DELETE /api/playbooks/:id    → delete a playbook
    // POST /api/playbooks/:id/run  → run a playbook (delegates to engine)
    if (parsed.pathname === '/api/playbooks' && req.method === 'GET') {
      const list = await loadPlaybooks().catch(() => [] as PlaybookDef[]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }

    if (parsed.pathname === '/api/playbooks' && req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const pb = JSON.parse(raw) as PlaybookDef;
        if (!pb.id || !pb.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id and name are required' }));
          return;
        }
        const list = await loadPlaybooks().catch(() => [] as PlaybookDef[]);
        const idx = list.findIndex(w => w.id === pb.id);
        if (idx >= 0) list[idx] = pb; else list.push(pb);
        await savePlaybooks(list);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pb));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    const pbIdMatch = parsed.pathname.match(/^\/api\/playbooks\/([^/]+)$/);
    const pbRunMatch = parsed.pathname.match(/^\/api\/playbooks\/([^/]+)\/run$/);

    if (pbRunMatch && req.method === 'POST') {
      const pbId = pbRunMatch[1];
      const list = await loadPlaybooks().catch(() => [] as PlaybookDef[]);
      const pb = list.find(w => w.id === pbId);
      if (!pb) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Playbook ${pbId} not found` }));
        return;
      }
      // Import engine and builtin handlers dynamically to avoid circular deps at startup
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, playbookId: pbId, message: 'Playbook run started' }));
      // Run async, broadcast events via dashboard
      Promise.resolve().then(async () => {
        try {
          const { runPlaybook } = await import('@monoes/monoplaybook');
          const { createBuiltinHandlers } = await import('../playbook/builtin-handlers.js');
          const handlers = createBuiltinHandlers();
          const record = await runPlaybook(pb, {
            handlers,
            onEvent: (evt) => { instance?.broadcast(evt); },
            isStopRequested: (id) => instance?.isStopRequested(id) ?? false,
          });
          instance?.addRunRecord(record);
        } catch (err) {
          console.error('[dashboard] playbook run error:', err);
        }
      });
      return;
    }

    if (pbIdMatch && req.method === 'GET') {
      const pbId = pbIdMatch[1];
      const list = await loadPlaybooks().catch(() => [] as PlaybookDef[]);
      const pb = list.find(w => w.id === pbId);
      if (!pb) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pb));
      return;
    }

    if (pbIdMatch && req.method === 'DELETE') {
      const pbId = pbIdMatch[1];
      const list = await loadPlaybooks().catch(() => [] as PlaybookDef[]);
      const newList = list.filter(w => w.id !== pbId);
      await savePlaybooks(newList);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, deleted: pbId }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  if (WebSocketServer) {
    const wss = new WebSocketServer({ server });
    wss.on('connection', async (ws: any, req: any) => {
      // Extract optional project-dir filter from the WebSocket upgrade URL
      const upgradeUrl = req?.url ?? '/ws';
      const upgradeParsed = new URL(upgradeUrl, 'http://localhost');
      const subscribedDir = upgradeParsed.searchParams.get('dir') ?? null;
      clientDirs.set(ws, subscribedDir);
      // Merge in-memory and persisted runs so history survives server restarts
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
      console.log(`Dashboard port ${port} in use — playbook will run without live dashboard.`);
    } else {
      console.error(`Dashboard server error: ${err.message}`);
    }
    // Replace with a no-op instance so the engine doesn't crash
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
      // Server-side project filtering: if the client subscribed with ?dir=<path>, only
      // deliver events whose projectDir matches.  Clients without a dir filter (subscribedDir
      // === null) receive all events, preserving backward-compatibility with ui.html.
      if (subscribedDir !== null && event.projectDir !== undefined && subscribedDir !== event.projectDir) {
        continue;
      }
      try {
        if (typeof client.send === 'function') {
          client.send(msg); // WebSocket
        } else {
          client.write(`data: ${msg}\n\n`); // SSE
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
