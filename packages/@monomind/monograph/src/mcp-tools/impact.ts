import type Database from 'better-sqlite3';
import { getNodesByIds, rowToNode } from '../storage/node-store.js';
import type { MonographNode } from '../types.js';
import { resolveNodeByName, type SymbolCandidate } from './resolve-node.js';

// ── Risk level ─────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export function computeRiskLevel(riskScore: number): RiskLevel {
  if (riskScore > 0.75) return 'CRITICAL';
  if (riskScore > 0.5) return 'HIGH';
  if (riskScore > 0.25) return 'MEDIUM';
  return 'LOW';
}

// ── Options ────────────────────────────────────────────────────────────────────

export interface ImpactOptions {
  minConfidenceScore?: number;
  relationTypes?: string[];
  maxDepth?: number;
}

// ── Output type ────────────────────────────────────────────────────────────────

export interface MonographImpactResult {
  node: MonographNode | null;
  directCallers: MonographNode[];
  transitiveCallers: Array<{ depth: number; nodes: MonographNode[] }>;
  affectedFiles: string[];
  /** Test files covering the node, its callers, or any affected file — what to run after a change. */
  affectedTests: string[];
  riskScore: number;
  riskLevel: RiskLevel;
  /** True when `name` matched several nodes and nothing narrowed it to one. */
  ambiguous?: boolean;
  /** Populated when ambiguous (non-test first) — re-query with `nodeId` or `filePath`. */
  candidates?: SymbolCandidate[];
}

// ── Reverse BFS on CALLS edges ────────────────────────────────────────────────

function reverseBfs(
  startNodeId: string,
  db: Database.Database,
  maxDepth: number,
  options: ImpactOptions = {},
): Map<string, number> {
  const visited = new Map<string, number>([[startNodeId, 0]]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startNodeId, depth: 0 }];

  // Default to a broad set of relation types, not just CALLS — a class extended
  // in 20 files, or a function only ever referenced via import/re-export (never
  // directly called), should still show up in the blast radius. A narrow default
  // reports "0 symbols affected, risk LOW" for changes that are anything but low
  // risk. Callers that need the old narrow/fast behavior can still pass
  // relationTypes: ['CALLS'] explicitly.
  const relations = options.relationTypes ?? [
    'CALLS',
    'IMPORTS',
    'REFERENCES',
    'EXTENDS',
    'RE_EXPORTS',
  ];
  const placeholders = relations.map(() => '?').join(',');
  const baseQuery = `SELECT source_id FROM edges WHERE target_id = ? AND relation IN (${placeholders})`;
  const query =
    options.minConfidenceScore !== undefined ? `${baseQuery} AND confidence_score >= ?` : baseQuery;

  const stmt = db.prepare(query);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const params: unknown[] = [id, ...relations];
    if (options.minConfidenceScore !== undefined) {
      params.push(options.minConfidenceScore);
    }
    const callers = stmt.all(...params) as Array<{ source_id: string }>;
    for (const { source_id } of callers) {
      if (!visited.has(source_id)) {
        visited.set(source_id, depth + 1);
        queue.push({ id: source_id, depth: depth + 1 });
      }
    }
  }

  return visited;
}

// ── Implementation ─────────────────────────────────────────────────────────────

/**
 * "What breaks if I change this?" — walks outward from a symbol through its
 * callers, importers, references and subclasses. Returns the affected symbols
 * by distance, the affected files, the tests that cover any of them
 * (`affectedTests`) and a risk level. A name that matches several definitions
 * comes back as candidates rather than a guess.
 */
export function getMonographImpact(
  db: Database.Database,
  input: { name: string; filePath?: string; nodeId?: string; depth?: number },
): MonographImpactResult {
  const maxDepth = Math.min(input.depth ?? 3, 6);

  // Find the node. Several same-named definitions (say, a test mock) are not
  // silently narrowed to one — a wrong "0 callers, LOW" is worse than asking.
  const { row: nodeRow, candidates } = input.nodeId
    ? {
        row: db.prepare('SELECT * FROM nodes WHERE id = ?').get(input.nodeId) as
          | Record<string, unknown>
          | undefined,
        candidates: [],
      }
    : resolveNodeByName(db, input.name, input.filePath);

  if (!nodeRow) {
    return {
      node: null,
      directCallers: [],
      transitiveCallers: [],
      affectedFiles: [],
      affectedTests: [],
      riskScore: 0,
      riskLevel: 'LOW',
      ambiguous: candidates.length > 1,
      candidates,
    };
  }

  const node = rowToNode(nodeRow);
  const nodeId = node.id;

  // Reverse BFS to find all callers (depth 0 = start node)
  const visited = reverseBfs(nodeId, db, maxDepth, {});
  return { node, ...extractCallerResult(db, nodeId, visited), ambiguous: false, candidates: [] };
}

// ── Shared helper: turn a visited map into structured caller lists ─────────────

function extractCallerResult(
  db: Database.Database,
  startNodeId: string,
  visited: Map<string, number>,
): Omit<MonographImpactResult, 'node'> {
  const directCallerIds: string[] = [];
  const byDepth = new Map<number, string[]>();

  for (const [id, depth] of visited.entries()) {
    if (id === startNodeId) continue;
    if (depth === 1) {
      directCallerIds.push(id);
    } else {
      const existing = byDepth.get(depth) ?? [];
      existing.push(id);
      byDepth.set(depth, existing);
    }
  }

  const directCallers = getNodesByIds(db, directCallerIds);

  const transitiveCallers: Array<{ depth: number; nodes: MonographNode[] }> = [];
  const sortedDepths = Array.from(byDepth.keys()).sort((a, b) => a - b);
  for (const depth of sortedDepths) {
    transitiveCallers.push({ depth, nodes: getNodesByIds(db, byDepth.get(depth)!) });
  }

  const allAffectedNodes = [...directCallers, ...transitiveCallers.flatMap((t) => t.nodes)];
  const affectedFiles = [
    ...new Set(allAffectedNodes.map((n) => n.filePath).filter((p): p is string => p != null)),
  ];

  const own = db.prepare('SELECT file_path FROM nodes WHERE id = ?').get(startNodeId) as
    | { file_path: string | null }
    | undefined;
  const affectedTests = findAffectedTests(
    db,
    [...visited.keys()],
    own?.file_path ? [own.file_path, ...affectedFiles] : affectedFiles,
  );

  const totalCallerCount = visited.size - 1; // exclude start node
  const rawScore = Math.min(Math.log2(totalCallerCount + 1), 10);
  const riskScore = rawScore / 10;

  return {
    directCallers,
    transitiveCallers,
    affectedFiles,
    affectedTests,
    riskScore,
    riskLevel: computeRiskLevel(riskScore),
  };
}

/** Test files with a TESTS edge to any impacted node or any impacted file. */
function findAffectedTests(db: Database.Database, nodeIds: string[], files: string[]): string[] {
  const targets = new Set(nodeIds);
  if (files.length > 0) {
    const rows = db
      .prepare(
        `SELECT id FROM nodes WHERE label = 'File' AND file_path IN (${files.map(() => '?').join(',')})`,
      )
      .all(...files) as { id: string }[];
    for (const r of rows) targets.add(r.id);
  }
  const ids = [...targets];
  const found = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = db
      .prepare(
        `SELECT DISTINCT s.file_path AS p FROM edges e JOIN nodes s ON s.id = e.source_id
         WHERE e.relation = 'TESTS' AND e.target_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .all(...chunk) as { p: string | null }[];
    for (const r of rows) if (r.p) found.add(r.p);
  }
  return [...found].sort();
}

// ── id-based impact with filtering options ────────────────────────────────────

export async function monographImpact(
  db: Database.Database,
  nodeId: string,
  options: ImpactOptions = {},
): Promise<MonographImpactResult> {
  const maxDepth = Math.min(options.maxDepth ?? 3, 6);

  const nodeRow = db.prepare('SELECT * FROM nodes WHERE id = ? LIMIT 1').get(nodeId) as
    | Record<string, unknown>
    | undefined;

  if (!nodeRow) {
    return {
      node: null,
      directCallers: [],
      transitiveCallers: [],
      affectedFiles: [],
      affectedTests: [],
      riskScore: 0,
      riskLevel: 'LOW',
    };
  }

  const node = rowToNode(nodeRow);
  const visited = reverseBfs(nodeId, db, maxDepth, options);
  return { node, ...extractCallerResult(db, nodeId, visited) };
}
