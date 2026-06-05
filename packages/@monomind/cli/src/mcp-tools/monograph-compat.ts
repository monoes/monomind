/**
 * Monograph Compatibility Layer
 *
 * Provides the ~27 high-level functions that the CLI calls but that are NOT
 * exported by @monoes/monograph@1.1.0 (which only exports low-level primitives).
 *
 * All implementations are composed from the real published primitives.
 * Where primitives are insufficient, behaviour degrades honestly with correctly-
 * shaped return values so that handler code that accesses specific fields never throws.
 *
 * Import pattern:
 *   - Real primitives: from '@monoes/monograph'
 *   - These compat functions: from './monograph-compat.js'
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { createServer } from 'http';
import { performance } from 'perf_hooks';

import {
  openDb,
  closeDb,
  ftsSearch,
  getNode,
  getNodesForFile,
  getEdgesForSource,
  getEdgesForTarget,
  countNodes,
  countEdges,
  snapshotFromDb,
  toHtml,
  MonographError,
} from '@monoes/monograph';

// Re-export type alias used internally
type Db = ReturnType<typeof openDb>;

// ─── Tier 1: Fully implementable from primitives ───────────────────────────────

// 1. hybridQuery
// BM25-only at monograph@1.1.0 (no vector storage). score = -rank (descending, .toFixed-safe).
// NOTE: no vector merge is possible at 1.1.0 — pure BM25.
export async function hybridQuery(
  db: Db,
  query: string,
  opts: { limit?: number; label?: string } = {},
): Promise<{ id: string; name: string; label: string; filePath: string | null; score: number }[]> {
  const limit = opts.limit ?? 20;
  const label = opts.label;
  const hits = ftsSearch(db, query, limit, label);
  return hits.map(h => ({
    id: h.id,
    name: h.name,
    label: h.label,
    filePath: h.filePath ?? null,
    score: -h.rank, // descending: higher = better
  }));
}

// Also export a positional overload so commands/monograph.ts semanticSearch import
// can simply redirect here without changing call sites.
// semanticSearch(db, query, limit?, label?) -> same shape as hybridQuery results
export function semanticSearch(
  db: Db,
  query: string,
  limit?: number,
  label?: string,
): { id: string; name: string; label: string; normLabel: string; filePath: string | null; score: number }[] {
  // At 1.1.0 with no embeddings, semantic degrades to BM25.
  // score = -rank so callers using .score.toFixed() work correctly.
  const hits = ftsSearch(db, query, limit ?? 20, label);
  return hits.map(h => ({
    id: h.id,
    name: h.name,
    label: h.label,
    normLabel: h.normLabel,
    filePath: h.filePath ?? null,
    score: -h.rank,
  }));
}

// Helper: resolve a node by name (and optional filePath)
function resolveNode(db: Db, name: string, filePath?: string): ReturnType<typeof getNode> {
  if (filePath) {
    const candidates = getNodesForFile(db, filePath);
    const match = candidates.find(n => n.name === name);
    if (match) return match;
  }
  // Fall back to FTS/name scan
  const row = (db as any).prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1').get(name) as any;
  if (!row) return undefined;
  return {
    id: row.id,
    label: row.label,
    name: row.name,
    normLabel: row.norm_label,
    filePath: row.file_path ?? null,
    startLine: row.start_line ?? undefined,
    endLine: row.end_line ?? undefined,
    communityId: row.community_id ?? undefined,
    isExported: !!row.is_exported,
    language: row.language ?? undefined,
    properties: row.properties ? JSON.parse(row.properties) : undefined,
  };
}

// 2. getMonographContext
export function getMonographContext(
  db: Db,
  opts: { name: string; filePath?: string },
): {
  target: { id: string; name: string; label: string; filePath: string | null; communityId?: number };
  callers: { id: string; name: string; label: string; filePath: string | null }[];
  callees: { id: string; name: string; label: string; filePath: string | null }[];
  imports: { id: string; name: string; label: string; filePath: string | null }[];
  importedBy: { id: string; name: string; label: string; filePath: string | null }[];
  community: number | null;
  processes: string[];
} {
  const node = resolveNode(db, opts.name, opts.filePath);
  if (!node) {
    return {
      target: { id: '', name: opts.name, label: 'Unknown', filePath: opts.filePath ?? null },
      callers: [], callees: [], imports: [], importedBy: [],
      community: null, processes: [],
    };
  }

  const outEdges = getEdgesForSource(db, node.id);
  const inEdges = getEdgesForTarget(db, node.id);

  const resolve = (id: string) => {
    const n = getNode(db, id);
    if (!n) return null;
    return { id: n.id, name: n.name, label: n.label, filePath: n.filePath ?? null };
  };

  const callees = outEdges.filter(e => e.relation === 'CALLS').map(e => resolve(e.targetId)).filter(Boolean) as any[];
  const callers = inEdges.filter(e => e.relation === 'CALLS').map(e => resolve(e.sourceId)).filter(Boolean) as any[];
  const imports = outEdges.filter(e => e.relation === 'IMPORTS').map(e => resolve(e.targetId)).filter(Boolean) as any[];
  const importedBy = inEdges.filter(e => e.relation === 'IMPORTS').map(e => resolve(e.sourceId)).filter(Boolean) as any[];

  const processRelations = new Set(['STEP_IN_PROCESS', 'ENTRY_POINT_OF']);
  const processEdges = [...outEdges, ...inEdges].filter(e => processRelations.has(e.relation));
  const processes: string[] = [];
  for (const e of processEdges) {
    const pid = e.relation === 'STEP_IN_PROCESS' ? e.targetId : e.sourceId;
    const pn = getNode(db, pid);
    if (pn) processes.push(pn.name);
  }

  return {
    target: {
      id: node.id, name: node.name, label: node.label,
      filePath: node.filePath ?? null, communityId: node.communityId,
    },
    callers, callees, imports, importedBy,
    community: node.communityId ?? null,
    processes: [...new Set(processes)],
  };
}

// 3. getMonographImpact — reverse BFS over CALLS edges
export function getMonographImpact(
  db: Db,
  opts: { name: string; filePath?: string; depth?: number },
): {
  target: { id: string; name: string; label: string; filePath: string | null };
  impactedSymbols: { id: string; name: string; label: string; filePath: string | null; depth: number }[];
  totalImpacted: number;
  riskScore: number;
  maxDepthReached: number;
} {
  const node = resolveNode(db, opts.name, opts.filePath);
  if (!node) {
    return {
      target: { id: '', name: opts.name, label: 'Unknown', filePath: opts.filePath ?? null },
      impactedSymbols: [], totalImpacted: 0, riskScore: 0, maxDepthReached: 0,
    };
  }

  const maxDepth = Math.min(6, Math.max(1, (opts.depth ?? 3)));
  const visited = new Map<string, number>(); // id -> depth
  const queue: Array<{ id: string; depth: number }> = [{ id: node.id, depth: 0 }];
  let maxDepthReached = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) { maxDepthReached = Math.max(maxDepthReached, item.depth); continue; }
    const inEdges = getEdgesForTarget(db, item.id);
    for (const e of inEdges) {
      if (e.relation !== 'CALLS') continue;
      if (!visited.has(e.sourceId)) {
        const d = item.depth + 1;
        visited.set(e.sourceId, d);
        maxDepthReached = Math.max(maxDepthReached, d);
        queue.push({ id: e.sourceId, depth: d });
      }
    }
  }

  const impactedSymbols: { id: string; name: string; label: string; filePath: string | null; depth: number }[] = [];
  let crossFileCount = 0;

  for (const [id, depth] of visited) {
    const n = getNode(db, id);
    if (!n) continue;
    const fp = n.filePath ?? null;
    if (fp !== (node.filePath ?? null)) crossFileCount++;
    impactedSymbols.push({ id: n.id, name: n.name, label: n.label, filePath: fp, depth });
  }

  const total = impactedSymbols.length;
  const crossFraction = total > 0 ? crossFileCount / total : 0;
  const riskScore = Math.min(100, Math.round(total * (1 + crossFraction)));

  return {
    target: { id: node.id, name: node.name, label: node.label, filePath: node.filePath ?? null },
    impactedSymbols,
    totalImpacted: total,
    riskScore,
    maxDepthReached,
  };
}

// 4. getMonographRename — always dry-run, never writes
export function getMonographRename(
  db: Db,
  opts: { oldName: string; newName: string; filePath?: string; dryRun?: boolean },
): {
  oldName: string;
  newName: string;
  occurrences: { filePath: string | null; line: number | null; kind: string }[];
  fileCount: number;
  dryRun: true;
} {
  const nodes: Array<ReturnType<typeof getNode>> = [];
  if (opts.filePath) {
    const candidates = getNodesForFile(db, opts.filePath);
    nodes.push(...candidates.filter(n => n.name === opts.oldName));
  }
  if (nodes.length === 0) {
    const rows = (db as any).prepare('SELECT * FROM nodes WHERE name = ?').all(opts.oldName) as any[];
    nodes.push(...rows.map((r: any) => resolveNode(db, r.name)));
  }

  const occurrences: { filePath: string | null; line: number | null; kind: string }[] = [];
  const files = new Set<string>();

  for (const node of nodes) {
    if (!node) continue;
    occurrences.push({ filePath: node.filePath ?? null, line: node.startLine ?? null, kind: 'definition' });
    if (node.filePath) files.add(node.filePath);

    const outEdges = getEdgesForSource(db, node.id);
    const inEdges = getEdgesForTarget(db, node.id);

    for (const e of [...outEdges, ...inEdges]) {
      const refId = e.sourceId === node.id ? e.targetId : e.sourceId;
      const refNode = getNode(db, refId);
      if (refNode) {
        occurrences.push({ filePath: refNode.filePath ?? null, line: refNode.startLine ?? null, kind: e.relation });
        if (refNode.filePath) files.add(refNode.filePath);
      }
    }
  }

  return {
    oldName: opts.oldName,
    newName: opts.newName,
    occurrences,
    fileCount: files.size,
    dryRun: true,
  };
}

// 5. detectMonographChanges
export function detectMonographChanges(
  db: Db,
  opts: { baseBranch?: string; includeTests?: boolean },
  repoPath: string,
): {
  baseBranch: string;
  changedFiles: string[];
  affectedSymbols: { id: string; name: string; label: string; filePath: string }[];
  symbolCount: number;
} {
  const base = opts.baseBranch ?? 'main';
  let changedFiles: string[] = [];

  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      cwd: repoPath, encoding: 'utf-8',
    }).trim();
    changedFiles = out.split('\n').filter(Boolean);
  } catch {
    // git error — return empty
  }

  if (opts.includeTests === false) {
    changedFiles = changedFiles.filter(f => !f.includes('test') && !f.includes('spec') && !f.includes('__tests__'));
  }

  const affectedSymbols: { id: string; name: string; label: string; filePath: string }[] = [];
  const seenIds = new Set<string>();

  for (const rel of changedFiles) {
    const abs = join(repoPath, rel);
    const nodes = getNodesForFile(db, abs);
    for (const n of nodes) {
      if (!seenIds.has(n.id)) {
        seenIds.add(n.id);
        affectedSymbols.push({ id: n.id, name: n.name, label: n.label, filePath: n.filePath ?? abs });
      }
    }
  }

  return { baseBranch: base, changedFiles, affectedSymbols, symbolCount: affectedSymbols.length };
}

// 6. getMonographRouteMap
export function getMonographRouteMap(
  db: Db,
  opts: { prefix?: string; method?: string; includeMiddleware?: boolean },
): {
  routes: { path: string; method: string; handler: string | null; filePath: string | null; line: number | null }[];
  total: number;
} {
  const rows = (db as any).prepare("SELECT * FROM nodes WHERE label = 'Route'").all() as any[];
  const includeMiddleware = opts.includeMiddleware ?? false;

  let routes: { path: string; method: string; handler: string | null; filePath: string | null; line: number | null }[] = [];

  for (const row of rows) {
    let props: Record<string, unknown> = {};
    try { props = row.properties ? JSON.parse(row.properties) : {}; } catch { /* skip */ }

    const routePath = (props.path as string | undefined) ?? row.name ?? '';
    const method = ((props.method as string | undefined) ?? 'ANY').toUpperCase();

    if (!includeMiddleware && method === 'USE') continue;
    if (opts.prefix && !routePath.includes(opts.prefix)) continue;
    if (opts.method && method !== opts.method.toUpperCase()) continue;

    // Resolve handler via HANDLES_ROUTE edges
    const outEdges = getEdgesForSource(db, row.id);
    const handlerEdge = outEdges.find(e => e.relation === 'HANDLES_ROUTE');
    let handlerName: string | null = null;
    if (handlerEdge) {
      const hn = getNode(db, handlerEdge.targetId);
      if (hn) handlerName = hn.name;
    }

    routes.push({
      path: routePath,
      method,
      handler: handlerName,
      filePath: row.file_path ?? null,
      line: row.start_line ?? null,
    });
  }

  return { routes, total: routes.length };
}

// 7. getMonographApiImpact — forward BFS from route handler
export function getMonographApiImpact(
  db: Db,
  opts: { routePath: string; method?: string },
): {
  route: string;
  handler: string | null;
  impactedSymbols: { id: string; name: string; label: string; filePath: string | null; depth: number }[];
  totalImpacted: number;
  riskScore: number;
} {
  const rows = (db as any).prepare("SELECT * FROM nodes WHERE label = 'Route'").all() as any[];
  let handlerNodeId: string | null = null;
  let handlerName: string | null = null;

  for (const row of rows) {
    let props: Record<string, unknown> = {};
    try { props = row.properties ? JSON.parse(row.properties) : {}; } catch { /* skip */ }
    const rp = (props.path as string | undefined) ?? row.name ?? '';
    const rm = ((props.method as string | undefined) ?? 'ANY').toUpperCase();
    if (rp !== opts.routePath) continue;
    if (opts.method && rm !== opts.method.toUpperCase()) continue;

    const outEdges = getEdgesForSource(db, row.id);
    const he = outEdges.find(e => e.relation === 'HANDLES_ROUTE');
    if (he) {
      const hn = getNode(db, he.targetId);
      if (hn) { handlerNodeId = hn.id; handlerName = hn.name; }
    }
    break;
  }

  if (!handlerNodeId) {
    return { route: opts.routePath, handler: null, impactedSymbols: [], totalImpacted: 0, riskScore: 0 };
  }

  // Forward BFS over CALLS
  const visited = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: handlerNodeId, depth: 0 }];
  let crossFileCount = 0;
  const handlerNode = getNode(db, handlerNodeId);
  const handlerFile = handlerNode?.filePath ?? null;

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth >= 3) continue;
    const outEdges = getEdgesForSource(db, item.id);
    for (const e of outEdges) {
      if (e.relation !== 'CALLS') continue;
      if (!visited.has(e.targetId)) {
        const d = item.depth + 1;
        visited.set(e.targetId, d);
        const n = getNode(db, e.targetId);
        if (n && (n.filePath ?? null) !== handlerFile) crossFileCount++;
        queue.push({ id: e.targetId, depth: d });
      }
    }
  }

  const impactedSymbols: { id: string; name: string; label: string; filePath: string | null; depth: number }[] = [];
  for (const [id, depth] of visited) {
    const n = getNode(db, id);
    if (n) impactedSymbols.push({ id: n.id, name: n.name, label: n.label, filePath: n.filePath ?? null, depth });
  }

  const total = impactedSymbols.length;
  const crossFraction = total > 0 ? crossFileCount / total : 0;
  const riskScore = Math.min(100, Math.round(total * (1 + crossFraction)));

  return { route: opts.routePath, handler: handlerName, impactedSymbols, totalImpacted: total, riskScore };
}

// 8. getMonographStaleness
export async function getMonographStaleness(repoPath: string): Promise<{
  isStale: boolean;
  lastCommit: string | null;
  currentHead: string | null;
  commitsBehind: number;
  changedFiles: string[];
  firstDivergingCommitTime?: string;
}> {
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  let lastCommit: string | null = null;

  if (existsSync(dbPath)) {
    const db = openDb(dbPath);
    try {
      const meta = (db as any).prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as { value: string } | undefined;
      lastCommit = meta?.value ?? null;
    } finally {
      closeDb(db);
    }
  }

  let currentHead: string | null = null;
  let commitsBehind = 0;
  let changedFiles: string[] = [];
  let firstDivergingCommitTime: string | undefined;

  try {
    currentHead = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
  } catch { /* no git */ }

  if (lastCommit && currentHead) {
    try {
      const countOut = execSync(`git rev-list --count ${lastCommit}..HEAD`, { cwd: repoPath, encoding: 'utf-8' }).trim();
      commitsBehind = parseInt(countOut, 10) || 0;
    } catch { /* diverged/missing */ }

    try {
      const diffOut = execSync(`git diff --name-only ${lastCommit}...HEAD`, { cwd: repoPath, encoding: 'utf-8' }).trim();
      changedFiles = diffOut.split('\n').filter(Boolean);
    } catch { /* skip */ }

    if (commitsBehind > 0) {
      try {
        firstDivergingCommitTime = execSync(`git show -s --format=%cI ${lastCommit}..HEAD -- | head -1`, {
          cwd: repoPath, encoding: 'utf-8',
        }).trim() || undefined;
      } catch { /* skip */ }
    }
  }

  return {
    isStale: commitsBehind > 0,
    lastCommit,
    currentHead,
    commitsBehind,
    changedFiles,
    ...(firstDivergingCommitTime ? { firstDivergingCommitTime } : {}),
  };
}

// 9. runDoctor
export async function runDoctor(repoPath: string): Promise<{
  healthy: boolean;
  checks: { name: string; status: 'ok' | 'warn' | 'fail'; message: string }[];
}> {
  const checks: { name: string; status: 'ok' | 'warn' | 'fail'; message: string }[] = [];

  // Node version
  const nodeVer = process.versions.node;
  const [nodeMaj] = nodeVer.split('.').map(Number);
  checks.push({
    name: 'Node.js version',
    status: nodeMaj >= 20 ? 'ok' : 'warn',
    message: `${nodeVer}${nodeMaj < 20 ? ' (recommend >=20)' : ''}`,
  });

  // DB health
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  if (!existsSync(dbPath)) {
    checks.push({ name: 'Monograph DB', status: 'warn', message: 'DB not found. Run monograph build first.' });
  } else {
    let dbOk = false;
    let nodeCount = 0;
    try {
      const db = openDb(dbPath);
      nodeCount = countNodes(db);
      closeDb(db);
      dbOk = true;
    } catch (e) {
      checks.push({ name: 'Monograph DB', status: 'fail', message: `Cannot open DB: ${(e as Error).message}` });
    }
    if (dbOk) {
      checks.push({
        name: 'Monograph DB',
        status: nodeCount > 0 ? 'ok' : 'warn',
        message: nodeCount > 0 ? `${nodeCount} nodes indexed` : 'DB is empty — run monograph build',
      });
    }
  }

  // Disk space (best-effort)
  try {
    const dfOut = execSync('df -k .', { cwd: repoPath, encoding: 'utf-8' });
    const lines = dfOut.trim().split('\n');
    const dataLine = lines[1] ?? '';
    const parts = dataLine.split(/\s+/);
    const availKb = parseInt(parts[3] ?? '0', 10);
    const availMb = availKb / 1024;
    checks.push({
      name: 'Disk space',
      status: availMb > 500 ? 'ok' : 'warn',
      message: `${availMb.toFixed(0)} MB available`,
    });
  } catch {
    checks.push({ name: 'Disk space', status: 'warn', message: 'Could not check disk space' });
  }

  const healthy = checks.every(c => c.status !== 'fail');
  return { healthy, checks };
}

// 10a. getProcessesResource
export function getProcessesResource(db: Db): {
  processes: { id: string; name: string; steps: { id: string; name: string; filePath: string | null }[] }[];
} {
  const rows = (db as any).prepare("SELECT * FROM nodes WHERE label = 'Process'").all() as any[];
  const processes = rows.map((row: any) => {
    const inEdges = getEdgesForTarget(db, row.id);
    const steps = inEdges
      .filter(e => e.relation === 'STEP_IN_PROCESS')
      .map(e => {
        const n = getNode(db, e.sourceId);
        return n ? { id: n.id, name: n.name, filePath: n.filePath ?? null } : null;
      })
      .filter(Boolean) as { id: string; name: string; filePath: string | null }[];
    return { id: row.id, name: row.name, steps };
  });
  return { processes };
}

// 10b. getCommunitiesResource
export function getCommunitiesResource(db: Db): {
  communities: { id: number; label: string; size: number; cohesionScore: number | null; members: string[] }[];
} {
  let communities: { id: number; label: string; size: number; cohesionScore: number | null; members: string[] }[] = [];
  try {
    const rows = (db as any).prepare('SELECT * FROM communities ORDER BY id').all() as any[];
    communities = rows.map((row: any) => {
      const memberRows = (db as any).prepare(
        'SELECT name FROM nodes WHERE community_id = ? AND label NOT IN (\'File\',\'Folder\',\'Community\') LIMIT 20'
      ).all(row.id) as any[];
      return {
        id: row.id,
        label: row.label ?? `community-${row.id}`,
        size: row.size ?? 0,
        cohesionScore: row.cohesion_score ?? null,
        members: memberRows.map((m: any) => m.name as string),
      };
    });
  } catch {
    // communities table may not exist
  }
  return { communities };
}

// 10c. getSchemaResource
export function getSchemaResource(db: Db): {
  labels: string[];
  relations: string[];
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
} {
  const labels = ((db as any).prepare('SELECT DISTINCT label FROM nodes ORDER BY label').all() as any[]).map((r: any) => r.label as string);
  const relations = ((db as any).prepare('SELECT DISTINCT relation FROM edges ORDER BY relation').all() as any[]).map((r: any) => r.relation as string);
  const nc = countNodes(db);
  const ec = countEdges(db);
  let communityCount = 0;
  try {
    communityCount = ((db as any).prepare('SELECT COUNT(*) as n FROM communities').get() as any).n as number;
  } catch { /* no communities table */ }
  return { labels, relations, nodeCount: nc, edgeCount: ec, communityCount };
}

// 10d. getGraphResource
export function getGraphResource(db: Db): { nodes: unknown[]; edges: unknown[] } {
  let nodes: unknown[] = [];
  let edges: unknown[] = [];
  try {
    const snap = snapshotFromDb(db);
    // snapshotFromDb returns a graphology graph; export via raw SQL for a stable shape
    nodes = (db as any).prepare('SELECT * FROM nodes LIMIT 2000').all();
    edges = (db as any).prepare('SELECT * FROM edges LIMIT 10000').all();
  } catch {
    nodes = (db as any).prepare('SELECT * FROM nodes LIMIT 2000').all();
    edges = (db as any).prepare('SELECT * FROM edges LIMIT 10000').all();
  }
  return { nodes, edges };
}

// ─── Tier 2: Best-effort / correctly-shaped degradation ───────────────────────

// 11. getMonographCypher — minimal single-hop MATCH evaluator
// IMPORTANT: does NOT delegate to toCypher() which serializes the graph.
// Returns {rows, error?, queryTime} so handlers can do Object.keys(rows[0]) and result.queryTime.
export function getMonographCypher(
  db: Db,
  query: string,
): { rows: Record<string, unknown>[]; error?: string; queryTime: number } {
  const t0 = performance.now();

  // Block writes
  const writePattern = /\b(CREATE|MERGE|SET|DELETE|REMOVE|DROP)\b/i;
  if (writePattern.test(query)) {
    return { rows: [], error: 'write ops not allowed', queryTime: performance.now() - t0 };
  }

  // Parse a single-hop MATCH:
  // MATCH (a[:Label] [{name:"x"}])-[:REL]->(b[:Label]) RETURN a.prop, b.prop, ...
  // OR: MATCH (a[:Label] [{name:"x"}]) RETURN a.prop, ...
  const matchRe = /MATCH\s*\((\w+)(?::(\w+))?(?:\s*\{([^}]*)\})?\)(?:\s*-\[:(\w+)\]->\s*\((\w+)(?::(\w+))?\))?\s*RETURN\s+(.+)/i;
  const m = query.match(matchRe);

  if (!m) {
    return {
      rows: [],
      error: 'unsupported query (compat supports single-hop MATCH only)',
      queryTime: performance.now() - t0,
    };
  }

  const [, aVar, aLabel, aProps, rel, bVar, bLabel, returnClause] = m;

  // Parse anchor properties {name:"x", ...}
  const anchorParams: Record<string, string> = {};
  if (aProps) {
    const propRe = /(\w+)\s*:\s*["']([^"']*)["']/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(aProps)) !== null) {
      anchorParams[pm[1]] = pm[2];
    }
  }

  // Parse RETURN columns
  const returnCols = returnClause.split(',').map(s => s.trim());

  // Helper to map aliasVar.field -> SQL column
  const fieldToCol: Record<string, string> = {
    id: 'id', name: 'name', label: 'label', filePath: 'file_path',
    startLine: 'start_line', endLine: 'end_line', communityId: 'community_id',
    isExported: 'is_exported', language: 'language',
  };

  try {
    let rows: Record<string, unknown>[];

    if (rel && bVar) {
      // Two-node pattern with relationship
      let sql = 'SELECT n1.id as n1_id, n1.name as n1_name, n1.label as n1_label, n1.file_path as n1_file_path, n1.start_line as n1_start_line, n2.id as n2_id, n2.name as n2_name, n2.label as n2_label, n2.file_path as n2_file_path, n2.start_line as n2_start_line FROM nodes n1 JOIN edges e ON e.source_id = n1.id JOIN nodes n2 ON n2.id = e.target_id WHERE e.relation = ?';
      const params: unknown[] = [rel];
      if (aLabel) { sql += ' AND n1.label = ?'; params.push(aLabel); }
      if (bLabel) { sql += ' AND n2.label = ?'; params.push(bLabel); }
      for (const [k, v] of Object.entries(anchorParams)) {
        const col = fieldToCol[k] ?? k;
        sql += ` AND n1.${col} = ?`;
        params.push(v);
      }
      sql += ' LIMIT 100';
      const rawRows = (db as any).prepare(sql).all(...params) as any[];

      rows = rawRows.map((r: any) => {
        const out: Record<string, unknown> = {};
        for (const col of returnCols) {
          const dotIdx = col.indexOf('.');
          if (dotIdx === -1) { out[col] = null; continue; }
          const varPart = col.slice(0, dotIdx);
          const fieldPart = col.slice(dotIdx + 1);
          const prefix = varPart === aVar ? 'n1' : varPart === bVar ? 'n2' : null;
          if (!prefix) { out[col] = null; continue; }
          const dbCol = fieldToCol[fieldPart] ?? fieldPart;
          out[col] = r[`${prefix}_${dbCol}`] ?? r[`${prefix}_${fieldPart}`] ?? null;
        }
        return out;
      });
    } else {
      // Single-node pattern
      let sql = 'SELECT * FROM nodes n1 WHERE 1=1';
      const params: unknown[] = [];
      if (aLabel) { sql += ' AND n1.label = ?'; params.push(aLabel); }
      for (const [k, v] of Object.entries(anchorParams)) {
        const col = fieldToCol[k] ?? k;
        sql += ` AND n1.${col} = ?`;
        params.push(v);
      }
      sql += ' LIMIT 100';
      const rawRows = (db as any).prepare(sql).all(...params) as any[];

      rows = rawRows.map((r: any) => {
        const out: Record<string, unknown> = {};
        for (const col of returnCols) {
          const dotIdx = col.indexOf('.');
          if (dotIdx === -1) { out[col] = r[col] ?? null; continue; }
          const fieldPart = col.slice(dotIdx + 1);
          const dbCol = fieldToCol[fieldPart] ?? fieldPart;
          out[col] = r[dbCol] ?? r[fieldPart] ?? null;
        }
        return out;
      });
    }

    return { rows, queryTime: performance.now() - t0 };
  } catch (err) {
    return {
      rows: [],
      error: `Query error: ${(err as Error).message}`,
      queryTime: performance.now() - t0,
    };
  }
}

// 12. augmentContext
export async function augmentContext(opts: {
  query: string;
  repoPath: string;
  topK?: number;
  format?: 'markdown' | 'json';
}): Promise<string> {
  const { topK = 10, format = 'markdown', query, repoPath } = opts;
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  if (!existsSync(dbPath)) return format === 'json' ? '[]' : '(no knowledge graph found — run monograph build)';

  const db = openDb(dbPath);
  try {
    const hits = ftsSearch(db, query, topK);
    if (hits.length === 0) return format === 'json' ? '[]' : '(no results)';

    if (format === 'json') {
      const result = hits.map(h => {
        const outEdges = getEdgesForSource(db, h.id);
        const inEdges = getEdgesForTarget(db, h.id);
        return {
          id: h.id, name: h.name, label: h.label, filePath: h.filePath ?? null,
          score: -h.rank,
          callers: inEdges.filter(e => e.relation === 'CALLS').map(e => e.sourceId),
          callees: outEdges.filter(e => e.relation === 'CALLS').map(e => e.targetId),
        };
      });
      return JSON.stringify(result, null, 2);
    }

    // Markdown
    const lines = [`## Monograph Context — "${query}"\n`];
    for (const h of hits) {
      lines.push(`### ${h.label}: ${h.name}`);
      if (h.filePath) lines.push(`*File:* \`${h.filePath}\``);
      lines.push(`*Score:* ${(-h.rank).toFixed(4)}`);

      const outEdges = getEdgesForSource(db, h.id);
      const inEdges = getEdgesForTarget(db, h.id);
      const callees = outEdges.filter(e => e.relation === 'CALLS').slice(0, 5);
      const callers = inEdges.filter(e => e.relation === 'CALLS').slice(0, 5);

      if (callees.length > 0) {
        lines.push(`*Calls:* ${callees.map(e => { const n = getNode(db, e.targetId); return n?.name ?? e.targetId; }).join(', ')}`);
      }
      if (callers.length > 0) {
        lines.push(`*Called by:* ${callers.map(e => { const n = getNode(db, e.sourceId); return n?.name ?? e.sourceId; }).join(', ')}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  } finally {
    closeDb(db);
  }
}

// 13. injectAiContext
export async function injectAiContext(opts: {
  repoPath: string;
  targets?: Array<'claude' | 'agents-md'>;
}): Promise<{ updated: string[] }> {
  const { repoPath, targets = ['claude', 'agents-md'] } = opts;
  const SENTINEL_START = '<!-- monograph:start -->';
  const SENTINEL_END = '<!-- monograph:end -->';
  const block = `${SENTINEL_START}
## Knowledge Graph — Monograph (Use Before Codebase Exploration)

**MANDATORY: Graph-First, Grep-Last.**
Before ANY grep/rg/find via Bash for code navigation, call \`mcp__monomind__monograph_query\` first.
Only fall back to Bash grep if monograph returns 0 results or the DB is missing.

When starting any task touching 3+ files:
1. \`mcp__monomind__monograph_suggest\` — relevant nodes ranked by task description
2. \`mcp__monomind__monograph_context\` — 360° view of a symbol (callers, callees, imports)
3. \`mcp__monomind__monograph_impact\` — blast radius before changing anything

Key tools: monograph_query (BM25 search, file+line), monograph_context (symbol 360°),
monograph_impact (blast radius), monograph_detect_changes (git diff → symbols),
monograph_rename (dry-run multi-file rename), monograph_route_map (HTTP routes),
monograph_cypher (single-hop graph query), monograph_augment (graph-RAG context).

If graph is empty: call monograph_build (codeOnly:true) and proceed with grep while it builds.
${SENTINEL_END}`;

  const updated: string[] = [];
  const fileMaps: Record<string, string> = {
    'claude': join(repoPath, 'CLAUDE.md'),
    'agents-md': join(repoPath, 'AGENTS.md'),
  };

  for (const target of targets) {
    const fp = fileMaps[target];
    if (!fp) continue;
    try {
      let content = existsSync(fp) ? readFileSync(fp, 'utf-8') : '';
      if (content.includes(SENTINEL_START)) {
        content = content.replace(new RegExp(`${SENTINEL_START}[\\s\\S]*?${SENTINEL_END}`, 'g'), block);
      } else {
        content = content.trimEnd() + '\n\n' + block + '\n';
      }
      writeFileSync(fp, content, 'utf-8');
      updated.push(fp);
    } catch { /* skip unwritable */ }
  }

  return { updated };
}

// 14. getToolMap
export function getToolMap(
  db: Db,
  opts: { tool?: string },
): { tool: string; handler: string | null; filePath: string | null; line: number | null }[] {
  // Look for Route or nodes with HANDLES_TOOL edges
  const rows = (db as any).prepare("SELECT * FROM nodes WHERE label IN ('Route', 'Tool')").all() as any[];
  const results: { tool: string; handler: string | null; filePath: string | null; line: number | null }[] = [];

  for (const row of rows) {
    const toolName = row.name as string;
    if (opts.tool && !toolName.includes(opts.tool)) continue;

    const outEdges = getEdgesForSource(db, row.id);
    const handleEdge = outEdges.find(e => e.relation === 'HANDLES_TOOL' || e.relation === 'HANDLES_ROUTE');
    let handlerName: string | null = null;
    if (handleEdge) {
      const hn = getNode(db, handleEdge.targetId);
      if (hn) handlerName = hn.name;
    }
    results.push({ tool: toolName, handler: handlerName, filePath: row.file_path ?? null, line: row.start_line ?? null });
  }

  return results;
}

// 15. getShapeCheck
export function getShapeCheck(
  db: Db,
  _repoPath: string,
  opts: { route?: string; file?: string },
): { mismatches: { route: string; producerKeys: string[]; consumerKeys: string[]; missing: string[] }[]; checked: number; ok: boolean } {
  // Best-effort: attempt to find Route nodes and compare declared response keys.
  // If property data lacks key info, return honest empty (handler handles this gracefully).
  const rows = (db as any).prepare("SELECT * FROM nodes WHERE label = 'Route'").all() as any[];
  let checked = 0;
  const mismatches: { route: string; producerKeys: string[]; consumerKeys: string[]; missing: string[] }[] = [];

  for (const row of rows) {
    const routePath = row.name as string;
    if (opts.route && !routePath.includes(opts.route)) continue;
    if (opts.file && !(row.file_path ?? '').includes(opts.file)) continue;
    checked++;

    let props: Record<string, unknown> = {};
    try { props = row.properties ? JSON.parse(row.properties) : {}; } catch { /* skip */ }

    const producerKeys = Array.isArray(props.responseKeys) ? props.responseKeys as string[] : [];
    if (producerKeys.length === 0) continue; // no key data available

    // Find ACCESSES edges to see what consumers expect
    const inEdges = getEdgesForTarget(db, row.id);
    const consumerKeys: string[] = inEdges
      .filter(e => e.relation === 'ACCESSES')
      .map(e => {
        const n = getNode(db, e.sourceId);
        return n?.name ?? null;
      })
      .filter(Boolean) as string[];

    const missing = consumerKeys.filter(k => !producerKeys.includes(k));
    if (missing.length > 0) {
      mismatches.push({ route: routePath, producerKeys, consumerKeys, missing });
    }
  }

  return { mismatches, checked, ok: mismatches.length === 0 };
}

// 16. generateSkillFiles
export async function generateSkillFiles(
  repoPath: string,
  outputDir?: string,
): Promise<{ communityCount: number; filesWritten: string[] }> {
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  if (!existsSync(dbPath)) return { communityCount: 0, filesWritten: [] };

  const outDir = outputDir ?? join(repoPath, '.monomind', 'skills');
  mkdirSync(outDir, { recursive: true });

  const db = openDb(dbPath);
  try {
    const communityIds = (db as any).prepare(`
      SELECT DISTINCT community_id FROM nodes
      WHERE community_id IS NOT NULL
        AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
      ORDER BY community_id
    `).all() as Array<{ community_id: number }>;

    const filesWritten: string[] = [];

    for (const { community_id } of communityIds) {
      // Derive name from folder distribution
      const pathRows = (db as any).prepare(`
        SELECT file_path FROM nodes
        WHERE community_id = ? AND file_path IS NOT NULL
          AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
        LIMIT 20
      `).all(community_id) as Array<{ file_path: string }>;

      let name = `community-${community_id}`;
      const folderCounts = new Map<string, number>();
      const genericFolders = new Set(['src', 'lib', 'core', 'utils', 'common', 'shared', 'helpers', 'dist']);
      for (const row of pathRows) {
        const parts = (row.file_path as string).replace(/\\/g, '/').split('/').filter(Boolean);
        if (parts.length >= 2) {
          const folder = parts[parts.length - 2].toLowerCase();
          if (!genericFolders.has(folder)) {
            folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
          }
        }
      }
      let bestCount = 0;
      for (const [folder, count] of folderCounts) {
        if (count > bestCount) { bestCount = count; name = folder; }
      }

      const symbolRows = (db as any).prepare(`
        SELECT name FROM nodes
        WHERE community_id = ? AND is_exported = 1
          AND label NOT IN ('File', 'Folder', 'Community', 'Concept')
        ORDER BY name LIMIT 50
      `).all(community_id) as Array<{ name: string }>;

      const symbols = symbolRows.map((r: { name: string }) => r.name);
      const content = `# Community: ${name}\n\nCommunity ID: ${community_id}\n\n## Exported Symbols\n\n${symbols.map(s => `- ${s}`).join('\n') || '(none)'}\n`;
      const fp = join(outDir, `${name}-${community_id}.md`);
      writeFileSync(fp, content, 'utf-8');
      filesWritten.push(fp);
    }

    return { communityCount: communityIds.length, filesWritten };
  } finally {
    closeDb(db);
  }
}

// 17. installSkillsForPlatform
export async function installSkillsForPlatform(
  repoPath: string,
  communities: Array<{ name: string; symbols: string[] }>,
  opts: { platform: 'claude' | 'cursor' | 'vscode' | 'zed' },
): Promise<{ platform: string; outputDir: string; filesWritten: string[] }> {
  const platformDirs: Record<string, string> = {
    claude: join(repoPath, '.claude', 'skills'),
    cursor: join(repoPath, '.cursor', 'rules'),
    vscode: join(repoPath, '.vscode'),
    zed: join(repoPath, '.zed'),
  };
  const outputDir = platformDirs[opts.platform] ?? join(repoPath, `.${opts.platform}`, 'skills');
  mkdirSync(outputDir, { recursive: true });

  const filesWritten: string[] = [];
  for (const c of communities) {
    const content = `# ${c.name}\n\n## Exported Symbols\n\n${c.symbols.map(s => `- ${s}`).join('\n') || '(none)'}\n`;
    const fp = join(outputDir, `${c.name}.md`);
    writeFileSync(fp, content, 'utf-8');
    filesWritten.push(fp);
  }

  return { platform: opts.platform, outputDir, filesWritten };
}

// 18. runEmbed — embeddings unsupported at 1.1.0; throws so handler catches gracefully
export async function runEmbed(
  _db: Db,
  _opts: { codeOnly?: boolean; force?: boolean },
): Promise<{ model: string; embedded: number; skipped: number }> {
  throw new MonographError('Embeddings are not supported in @monoes/monograph@1.1.0 — upgrade to a version with native vector storage, or install @huggingface/transformers and a compat build.');
}

// ─── Groups (Tier 2) ──────────────────────────────────────────────────────────

// Helper: read group config (groups.json or group.yaml)
function readGroupConfig(configPath: string): Array<{ name?: string; path: string }> {
  if (!existsSync(configPath)) return [];
  try {
    const raw = readFileSync(configPath, 'utf-8');
    if (configPath.endsWith('.json')) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : (parsed.repos ?? parsed.groups ?? []);
    }
    // YAML — try js-yaml if available, else basic key:value parse
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yaml = require('js-yaml') as { load: (s: string) => unknown };
      const parsed = yaml.load(raw) as any;
      return Array.isArray(parsed) ? parsed : (parsed?.repos ?? parsed?.groups ?? []);
    } catch {
      return []; // js-yaml not available
    }
  } catch {
    return [];
  }
}

// 19. getGroupList
export async function getGroupList(
  configPath: string,
): Promise<{ repo: string; path: string; nodeCount: number; indexedAt: string | null }[]> {
  const repos = readGroupConfig(configPath);
  const result: { repo: string; path: string; nodeCount: number; indexedAt: string | null }[] = [];

  for (const repo of repos) {
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    let nodeCount = 0;
    let indexedAt: string | null = null;
    if (existsSync(dbPath)) {
      try {
        const db = openDb(dbPath);
        nodeCount = countNodes(db);
        const meta = (db as any).prepare("SELECT value FROM index_meta WHERE key = 'indexedAt'").get() as any;
        indexedAt = meta?.value ?? null;
        closeDb(db);
      } catch { /* skip */ }
    }
    result.push({ repo: repo.name ?? repoPath, path: repoPath, nodeCount, indexedAt });
  }

  return result;
}

// 20. runGroupQuery
export async function runGroupQuery(
  configPath: string,
  query: string,
  limit?: number,
): Promise<{ id: string; name: string; label: string; filePath: string | null; repo: string; score: number }[]> {
  const repos = readGroupConfig(configPath);
  const K = 60;
  const perRepo = limit ?? 20;
  const allResults: { id: string; name: string; label: string; filePath: string | null; repo: string; rank: number; repoIdx: number }[] = [];

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    if (!existsSync(dbPath)) continue;
    try {
      const db = openDb(dbPath);
      const hits = ftsSearch(db, query, perRepo);
      closeDb(db);
      hits.forEach(h => {
        allResults.push({
          id: h.id, name: h.name, label: h.label, filePath: h.filePath ?? null,
          repo: repo.name ?? repoPath, rank: h.rank, repoIdx: i,
        });
      });
    } catch { /* skip inaccessible repo */ }
  }

  // RRF merge
  const scores = new Map<string, number>();
  const meta = new Map<string, (typeof allResults)[0]>();
  allResults.forEach((r, i) => {
    const key = `${r.repo}:${r.id}`;
    scores.set(key, (scores.get(key) ?? 0) + 1 / (K + r.rank));
    if (!meta.has(key)) meta.set(key, r);
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, perRepo)
    .map(([key, score]) => {
      const r = meta.get(key)!;
      return { id: r.id, name: r.name, label: r.label, filePath: r.filePath, repo: r.repo, score };
    });
}

// 21. runGroupSync
export async function runGroupSync(configPath: string): Promise<{ repos: number; contracts: number; written: string[] }> {
  const repos = readGroupConfig(configPath);
  if (repos.length === 0) return { repos: 0, contracts: 0, written: [] };

  let contractCount = 0;
  const written: string[] = [];

  for (const repo of repos) {
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    if (!existsSync(dbPath)) continue;
    try {
      const db = openDb(dbPath);
      const routes = (db as any).prepare("SELECT * FROM nodes WHERE label = 'Route'").all() as any[];
      contractCount += routes.length;
      closeDb(db);
    } catch { /* skip */ }
  }

  // Write contracts registry if we found any
  const configDir = configPath.replace(/[^/\\]+$/, '');
  const contractsPath = join(configDir, 'contracts.json');
  try {
    writeFileSync(contractsPath, JSON.stringify({ synced: new Date().toISOString(), contracts: contractCount }, null, 2));
    written.push(contractsPath);
  } catch { /* skip */ }

  return { repos: repos.length, contracts: contractCount, written };
}

// 22. getGroupContracts
export async function getGroupContracts(
  configPath: string,
): Promise<{ groupName: string; symbol: string; filePath: string | null; line: number | null }[]> {
  const repos = readGroupConfig(configPath);
  const result: { groupName: string; symbol: string; filePath: string | null; line: number | null }[] = [];

  for (const repo of repos) {
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    if (!existsSync(dbPath)) continue;
    try {
      const db = openDb(dbPath);
      const exported = (db as any).prepare(
        "SELECT * FROM nodes WHERE is_exported = 1 AND label NOT IN ('File','Folder','Community','Concept') LIMIT 100"
      ).all() as any[];
      closeDb(db);
      for (const n of exported) {
        result.push({
          groupName: repo.name ?? repoPath,
          symbol: n.name as string,
          filePath: n.file_path ?? null,
          line: n.start_line ?? null,
        });
      }
    } catch { /* skip */ }
  }

  return result;
}

// 23. getGroupStatus
export async function getGroupStatus(configPath: string): Promise<{
  totalGroups: number;
  indexedGroups: number;
  stalledGroups: number;
  groups: { name: string; indexed: boolean; stale: boolean; contractCount: number; lastSync?: string }[];
}> {
  const repos = readGroupConfig(configPath);
  if (repos.length === 0) {
    return { totalGroups: 0, indexedGroups: 0, stalledGroups: 0, groups: [] };
  }

  const groups: { name: string; indexed: boolean; stale: boolean; contractCount: number; lastSync?: string }[] = [];

  for (const repo of repos) {
    const repoPath = repo.path ?? '';
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    const name = repo.name ?? repoPath;
    if (!existsSync(dbPath)) {
      groups.push({ name, indexed: false, stale: false, contractCount: 0 });
      continue;
    }
    try {
      const db = openDb(dbPath);
      const nc = countNodes(db);
      const contracts = (db as any).prepare("SELECT COUNT(*) as n FROM nodes WHERE label = 'Route'").get() as any;
      const meta = (db as any).prepare("SELECT value FROM index_meta WHERE key = 'lastCommit'").get() as any;
      closeDb(db);
      groups.push({
        name,
        indexed: nc > 0,
        stale: false, // we'd need git to detect; default false
        contractCount: (contracts?.n as number) ?? 0,
        ...(meta?.value ? { lastSync: meta.value } : {}),
      });
    } catch {
      groups.push({ name, indexed: false, stale: false, contractCount: 0 });
    }
  }

  const indexedGroups = groups.filter(g => g.indexed).length;
  const stalledGroups = groups.filter(g => g.stale).length;

  return { totalGroups: groups.length, indexedGroups, stalledGroups, groups };
}

// ─── Tier 3: Minimal-real / graceful ─────────────────────────────────────────

// 24. serveMonograph — minimal node:http server with module-singleton
let _httpServer: ReturnType<typeof createServer> | null = null;
let _serverUrl: string | null = null;

export async function serveMonograph(opts: {
  port?: number;
  open?: boolean;
  db: Db;
}): Promise<{ status: 'started' | 'already_running'; url: string }> {
  const port = opts.port ?? 7374;

  if (_httpServer) {
    return { status: 'already_running', url: _serverUrl ?? `http://localhost:${port}` };
  }

  const nodes = (opts.db as any).prepare('SELECT * FROM nodes LIMIT 500').all() as any[];
  const edges = (opts.db as any).prepare('SELECT * FROM edges LIMIT 3000').all() as any[];
  const html = toHtml(nodes, edges);

  _httpServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    _httpServer!.listen(port, () => resolve()).on('error', reject);
  });

  _serverUrl = `http://localhost:${port}`;

  if (opts.open) {
    try {
      const platform = process.platform;
      const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
      execSync(`${cmd} ${_serverUrl}`, { stdio: 'ignore' });
    } catch { /* best-effort */ }
  }

  return { status: 'started', url: _serverUrl };
}

// 25. getWikiToolResult — graceful: no wiki table in 1.1.0
export function getWikiToolResult(
  _db: Db,
  _opts: { communityId?: string },
): { pages: Array<{ communityId: string; title: string; markdown: string }>; note?: string } {
  return { pages: [], note: 'wiki requires monograph >1.1.0' };
}

// 26. runWikiBuildTool — graceful
export async function runWikiBuildTool(
  _db: Db,
  _opts: { communityId?: string; force?: boolean; model?: string },
): Promise<{ generated: number; skipped: number; note: string }> {
  return { generated: 0, skipped: 0, note: 'wiki generation requires monograph >1.1.0' };
}

// 27. listRepos — reads ~/.monograph/registry.json
export function listRepos(): {
  name: string;
  path: string;
  lastIndexed?: string;
  nodeCount?: number;
  edgeCount?: number;
}[] {
  const registryPath = join(homedir(), '.monograph', 'registry.json');
  if (!existsSync(registryPath)) return [];
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const repos = Array.isArray(parsed) ? parsed : (parsed.repos ?? []);
    return repos.map((r: any) => ({
      name: r.name ?? r.path ?? '',
      path: r.path ?? '',
      ...(r.lastIndexed ? { lastIndexed: r.lastIndexed } : {}),
      ...(r.nodeCount != null ? { nodeCount: r.nodeCount as number } : {}),
      ...(r.edgeCount != null ? { edgeCount: r.edgeCount as number } : {}),
    }));
  } catch {
    return [];
  }
}
