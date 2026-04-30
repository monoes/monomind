import type { Application } from 'express';
import type Database from 'better-sqlite3';
import { ftsSearch } from '../storage/fts-store.js';

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
}
