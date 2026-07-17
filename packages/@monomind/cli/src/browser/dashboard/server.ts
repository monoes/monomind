import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readFile, readdir, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { StepEvent, RunRecord } from '../workflow/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 4243: the main monomind dashboard owns 4242 — keep this server off that port
const DEFAULT_PORT = 4243;
const RUNS_FILE = join(homedir(), '.monomind', 'browse-runs.json');
const MAX_PERSISTED_RUNS = 50;

// Persist recent runs so the main dashboard's /api/workflow-runs endpoint stays live.
// Atomic: write to a temp file, then rename over the target.
async function persistRuns(runs: RunRecord[]): Promise<void> {
  try {
    await mkdir(dirname(RUNS_FILE), { recursive: true });
    const tmp = RUNS_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(runs.slice(0, MAX_PERSISTED_RUNS), null, 2), 'utf8');
    await rename(tmp, RUNS_FILE);
  } catch {
    // best-effort — dashboard persistence must never break a workflow run
  }
}

async function readJsonSafe(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readMetricsDir(root: string): Promise<Record<string, unknown>> {
  const metricsDir = join(root, '.monomind', 'metrics');
  const out: Record<string, unknown> = {};
  try {
    const files = await readdir(metricsDir);
    await Promise.all(files.map(async (f) => {
      if (!f.endsWith('.json') || f.startsWith('.')) return;
      out[f.replace(/\.json$/, '')] = await readJsonSafe(join(metricsDir, f));
    }));
  } catch {
    // metrics dir may not exist yet — workers write it at session start (or: hooks worker run <name>)
  }
  return out;
}

async function collectDashboardState(root: string) {
  const [workerMetrics, swarmState, lastRoute, autoMemory] = await Promise.all([
    readMetricsDir(root),
    readJsonSafe(join(root, '.monomind', 'swarm', 'swarm-state.json')),
    readJsonSafe(join(root, '.monomind', 'last-route.json')),
    readJsonSafe(join(root, '.monomind', 'data', 'auto-memory-store.json')),
  ]);
  return { workerMetrics, swarmState, lastRoute, autoMemory };
}

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
    if (req.method === 'GET' && req.url === '/api/metrics') {
      try {
        const { workerMetrics, swarmState, lastRoute } = await collectDashboardState(process.cwd());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workerMetrics, swarmState, lastRoute, ts: Date.now() }));
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to collect metrics' }));
      }
      return;
    }
    if (req.method === 'GET' && req.url === '/api/dashboard') {
      try {
        const { workerMetrics, swarmState, lastRoute, autoMemory } = await collectDashboardState(process.cwd());
        const worker_metrics = Object.keys(workerMetrics).filter((k) => workerMetrics[k] != null);
        const summary = {
          worker_metrics,
          swarm_status: swarmState ?? null,
          last_route: lastRoute ?? null,
          pattern_count: Array.isArray(autoMemory) ? autoMemory.length : 0,
          memory_health: autoMemory ? 'ok' : 'unknown',
          ts: Date.now(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(summary));
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to collect dashboard summary' }));
      }
      return;
    }
    if (req.method === 'POST' && req.url === '/api/mastermind/event') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          JSON.parse(body); // validate before broadcast
          for (const client of clients) {
            if (client.readyState === client.OPEN) client.send(body);
          }
        } catch (e) {
          if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[dashboard] /api/mastermind/event received invalid JSON, not broadcast:', e);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
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

  // Maintain RunRecords from step events and persist run transitions to
  // ~/.monomind/browse-runs.json so /api/workflow-runs on the main dashboard is live.
  function trackRun(event: StepEvent): void {
    let run = recentRuns.find((r) => r.id === event.runId);
    if (!run) {
      run = {
        id: event.runId,
        workflowId: event.workflowId,
        workflowName: event.workflowName,
        status: 'running',
        startedAt: event.timestamp,
        itemsProcessed: 0,
        itemsTotal: event.itemTotal ?? 0,
      };
      recentRuns.unshift(run);
      if (recentRuns.length > MAX_PERSISTED_RUNS) recentRuns.length = MAX_PERSISTED_RUNS;
    }
    if (event.itemTotal != null) run.itemsTotal = event.itemTotal;
    if (event.eventType === 'step_completed' && event.itemIndex != null) {
      run.itemsProcessed = Math.max(run.itemsProcessed, event.itemIndex + 1);
    }
    if (event.eventType === 'run_completed') {
      run.status = 'completed';
      run.completedAt = event.timestamp;
    } else if (event.eventType === 'run_stopped') {
      run.status = 'stopped';
      run.completedAt = event.timestamp;
    } else if (event.eventType === 'step_failed') {
      run.status = 'failed';
      run.completedAt = event.timestamp;
      if (event.error) run.error = event.error;
    }
    // Persist on run lifecycle transitions (start/complete/stop/fail)
    if (event.eventType === 'run_started' || event.eventType === 'run_completed' ||
        event.eventType === 'run_stopped' || event.eventType === 'step_failed') {
      void persistRuns(recentRuns);
    }
  }

  instance = {
    port,
    broadcast(event: StepEvent) {
      trackRun(event);
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
