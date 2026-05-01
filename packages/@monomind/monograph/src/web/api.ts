import type { Application } from 'express';
import type Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { ftsSearch } from '../storage/fts-store.js';
import { globalJobRegistry } from './async-jobs.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiNode {
  id: string;
  name: string;
  label: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  communityId: number | null;
}

export interface ApiEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  confidenceScore: number;
}

export interface GraphData {
  nodes: ApiNode[];
  edges: ApiEdge[];
  communities: Record<string, string[]>;
}

export interface NodeDetail {
  node: ApiNode | null;
  callers: ApiNode[];
  callees: ApiNode[];
}

export interface StatsData {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  buildAt: string | null;
}

// ── Query helpers (testable in isolation) ─────────────────────────────────────

function rowToApiNode(row: Record<string, unknown>): ApiNode {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    label: row['label'] as string,
    filePath: (row['file_path'] as string | null) ?? null,
    startLine: (row['start_line'] as number | null) ?? null,
    endLine: (row['end_line'] as number | null) ?? null,
    communityId: (row['community_id'] as number | null) ?? null,
  };
}

export function queryGraph(db: Database.Database): GraphData {
  const nodeRows = db
    .prepare(
      'SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes LIMIT 2000',
    )
    .all() as Record<string, unknown>[];

  const nodes = nodeRows.map(rowToApiNode);
  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: ApiEdge[] = [];
  if (nodeIds.size > 0) {
    // Use a subquery instead of IN(?,...) to avoid SQLite's SQLITE_MAX_VARIABLE_NUMBER limit
    const edgeRows = db
      .prepare(
        `SELECT e.source_id, e.target_id, e.relation, e.confidence_score
         FROM edges e
         JOIN (SELECT id FROM nodes LIMIT 2000) n ON e.source_id = n.id
         LIMIT 10000`,
      )
      .all() as Record<string, unknown>[];

    for (const r of edgeRows) {
      edges.push({
        sourceId: r['source_id'] as string,
        targetId: r['target_id'] as string,
        relation: r['relation'] as string,
        confidenceScore: r['confidence_score'] as number,
      });
    }
  }

  const communities: Record<string, string[]> = {};
  for (const node of nodes) {
    if (node.communityId != null) {
      const key = String(node.communityId);
      if (!communities[key]) communities[key] = [];
      communities[key].push(node.id);
    }
  }

  return { nodes, edges, communities };
}

export function queryNode(db: Database.Database, id: string): NodeDetail {
  const nodeRow = db
    .prepare('SELECT id, name, label, file_path, start_line, end_line, community_id FROM nodes WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;

  if (!nodeRow) return { node: null, callers: [], callees: [] };

  const node = rowToApiNode(nodeRow);

  const callerRows = db
    .prepare(
      `SELECT n.id, n.name, n.label, n.file_path, n.start_line, n.end_line, n.community_id
       FROM nodes n JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation = 'CALLS' LIMIT 20`,
    )
    .all(id) as Record<string, unknown>[];

  const calleeRows = db
    .prepare(
      `SELECT n.id, n.name, n.label, n.file_path, n.start_line, n.end_line, n.community_id
       FROM nodes n JOIN edges e ON n.id = e.target_id
       WHERE e.source_id = ? AND e.relation = 'CALLS' LIMIT 20`,
    )
    .all(id) as Record<string, unknown>[];

  return {
    node,
    callers: callerRows.map(rowToApiNode),
    callees: calleeRows.map(rowToApiNode),
  };
}

export function querySearch(db: Database.Database, q: string): ApiNode[] {
  const results = ftsSearch(db, q, 10);
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    filePath: r.filePath,
    startLine: null,
    endLine: null,
    communityId: null,
  }));
}

export function queryStats(db: Database.Database): StatsData {
  const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
  const communityCount = (
    db.prepare('SELECT COUNT(DISTINCT community_id) as c FROM nodes WHERE community_id IS NOT NULL').get() as { c: number }
  ).c;
  const metaRow = db
    .prepare("SELECT value FROM index_meta WHERE key = 'indexed_at'")
    .get() as { value: string } | undefined;

  return {
    nodeCount,
    edgeCount,
    communityCount,
    buildAt: metaRow?.value ?? null,
  };
}

export interface GrepResult {
  id: string;
  name: string;
  label: string;
  filePath: string | null;
  startLine: number | null;
}

export function queryGrep(db: Database.Database, pattern: string, caseSensitive: boolean): GrepResult[] {
  const sql = caseSensitive
    ? `SELECT id, name, label, file_path, start_line FROM nodes WHERE name GLOB ? LIMIT 100`
    : `SELECT id, name, label, file_path, start_line FROM nodes WHERE name LIKE ? LIMIT 100`;
  const param = caseSensitive ? `*${pattern}*` : `%${pattern}%`;
  const rows = db.prepare(sql).all(param) as Record<string, unknown>[];
  return rows.map(r => ({
    id: r['id'] as string,
    name: r['name'] as string,
    label: r['label'] as string,
    filePath: (r['file_path'] as string | null) ?? null,
    startLine: (r['start_line'] as number | null) ?? null,
  }));
}

export interface FileLine {
  number: number;
  content: string;
}

export interface FileContent {
  path: string;
  totalLines: number;
  lines: FileLine[];
}

export function readFileContent(filePath: string, startLine?: number, endLine?: number): FileContent {
  const raw = readFileSync(filePath, 'utf8');
  const allLines = raw.split('\n');
  // Remove trailing empty line from split
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();

  const start = startLine ?? 1;
  const end = endLine ?? allLines.length;

  const lines: FileLine[] = [];
  for (let i = start - 1; i < end && i < allLines.length; i++) {
    lines.push({ number: i + 1, content: allLines[i]! });
  }

  return { path: filePath, totalLines: allLines.length, lines };
}

// ── Route setup ───────────────────────────────────────────────────────────────

export function setupApiRoutes(app: Application, db: Database.Database): void {
  app.get('/api/graph', (_req, res) => {
    try {
      res.json(queryGraph(db));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/nodes/:id', (req, res) => {
    try {
      const detail = queryNode(db, req.params['id'] ?? '');
      if (!detail.node) {
        res.status(404).json({ error: 'Node not found' });
        return;
      }
      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/search', (req, res) => {
    try {
      const q = (req.query['q'] as string | undefined) ?? '';
      if (!q.trim()) {
        res.json([]);
        return;
      }
      res.json(querySearch(db, q));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/stats', (_req, res) => {
    try {
      res.json(queryStats(db));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/file', (req, res) => {
    try {
      const filePath = (req.query['path'] as string | undefined) ?? '';
      if (!filePath) {
        res.status(400).json({ error: 'path query param required' });
        return;
      }
      const startLine = req.query['start'] ? parseInt(req.query['start'] as string, 10) : undefined;
      const endLine = req.query['end'] ? parseInt(req.query['end'] as string, 10) : undefined;
      res.json(readFileContent(filePath, startLine, endLine));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Async analyze job API
  app.post('/api/analyze', (req, res) => {
    const { repoPath } = req.body as { repoPath?: string };
    if (!repoPath) {
      res.status(400).json({ error: 'repoPath is required' });
      return;
    }
    const job = globalJobRegistry.create('analyze', { repoPath });
    globalJobRegistry.update(job.id, { status: 'running' });
    setImmediate(() => {
      globalJobRegistry.update(job.id, { status: 'done', result: { message: 'ok' } });
    });
    res.status(202).json({ jobId: job.id });
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = globalJobRegistry.get(req.params['id'] ?? '');
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const ok = globalJobRegistry.cancel(req.params['id'] ?? '');
    if (!ok) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ cancelled: true });
  });

  app.get('/api/grep', (req, res) => {
    try {
      const pattern = (req.query['q'] as string | undefined) ?? '';
      const caseSensitive = req.query['case'] === 'true';
      res.json(queryGrep(db, pattern, caseSensitive));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // SSE progress stream for a job
  app.get('/api/jobs/:id/progress', (req, res) => {
    const jobId = req.params['id'] ?? '';
    const job = globalJobRegistry.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send existing progress events
    for (const evt of globalJobRegistry.getProgress(jobId)) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }

    // Poll for new events until job is done
    let lastSent = globalJobRegistry.getProgress(jobId).length;
    const interval = setInterval(() => {
      const current = globalJobRegistry.get(jobId);
      if (!current) { clearInterval(interval); res.end(); return; }

      const all = globalJobRegistry.getProgress(jobId);
      for (let i = lastSent; i < all.length; i++) {
        res.write(`data: ${JSON.stringify(all[i])}\n\n`);
      }
      lastSent = all.length;

      if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') {
        res.write(`data: ${JSON.stringify({ phase: 'complete', status: current.status })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    }, 500);

    req.on('close', () => clearInterval(interval));
  });
}
