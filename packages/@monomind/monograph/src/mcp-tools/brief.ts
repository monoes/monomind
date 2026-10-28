import type Database from 'better-sqlite3';
import type { Embedder } from '../embeddings/store.js';
import { searchGraphFused } from '../search/fused-search.js';
import { assessRelevance } from '../search/relevance.js';
import { rowToNode } from '../storage/node-store.js';
import type { MonographNode } from '../types.js';
import { monographImpact, type RiskLevel } from './impact.js';

export interface BriefSymbol {
  node: MonographNode;
  relevance: number;
  callers: MonographNode[];
  callees: MonographNode[];
  /** Test files that call this symbol, or import its file. */
  tests: string[];
}

export interface MonographBrief {
  task: string;
  /** False when nothing in the graph is about the task — the lists below are then empty. */
  relevant: boolean;
  /** Best-matching code symbols/files, each with its immediate surroundings. */
  entryPoints: BriefSymbol[];
  /** Documentation sections about the task. */
  docs: MonographNode[];
  /** Blast radius of the single best entry point. */
  impact: {
    nodeId: string;
    name: string;
    riskLevel: RiskLevel;
    riskScore: number;
    affectedFiles: string[];
    affectedTests: string[];
  } | null;
}

function related(
  db: Database.Database,
  nodeId: string,
  inbound: boolean,
  limit: number,
): MonographNode[] {
  const [filterCol, joinCol] = inbound ? ['target_id', 'source_id'] : ['source_id', 'target_id'];
  const rows = db
    .prepare(
      `SELECT n.* FROM nodes n JOIN edges e ON n.id = e.${joinCol}
       WHERE e.${filterCol} = ? AND e.relation = 'CALLS' LIMIT ?`,
    )
    .all(nodeId, limit) as Record<string, unknown>[];
  return rows.map(rowToNode);
}

function testsFor(db: Database.Database, node: MonographNode): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.file_path AS p FROM edges e JOIN nodes s ON s.id = e.source_id
       WHERE e.relation = 'TESTS' AND (e.target_id = ? OR e.target_id IN
         (SELECT id FROM nodes WHERE label = 'File' AND file_path = ?))`,
    )
    .all(node.id, node.filePath ?? '') as { p: string | null }[];
  return rows.flatMap((r) => (r.p ? [r.p] : [])).sort();
}

/**
 * One call that answers "where do I start on this task": the best code entry
 * points with their callers, callees and tests, the docs that cover it, and the
 * blast radius of the top hit — what an agent otherwise assembles from four or
 * five separate tool calls.
 */
export async function getMonographBrief(
  db: Database.Database,
  task: string,
  options: { entryPoints?: number; docs?: number; embedder?: Embedder | null } = {},
): Promise<MonographBrief> {
  const nEntry = options.entryPoints ?? 5;
  const nDocs = options.docs ?? 3;
  const { embedder } = options;
  const rawCode = await searchGraphFused(db, task, { limit: nEntry, scope: 'code', embedder });
  const rawDocs = await searchGraphFused(db, task, { limit: nDocs, scope: 'docs', embedder });
  const code = assessRelevance(db, task, rawCode).relevant ? rawCode : [];
  const docHits = assessRelevance(db, task, rawDocs).relevant ? rawDocs : [];

  const entryPoints: BriefSymbol[] = [];
  for (const hit of code) {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(hit.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) continue;
    const node = rowToNode(row);
    entryPoints.push({
      node,
      relevance: hit.relevance,
      callers: related(db, node.id, true, 4),
      callees: related(db, node.id, false, 4),
      tests: testsFor(db, node),
    });
  }

  const docs = docHits.flatMap((h) => {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(h.id) as
      | Record<string, unknown>
      | undefined;
    return row ? [rowToNode(row)] : [];
  });

  const top = entryPoints[0]?.node;
  let impact: MonographBrief['impact'] = null;
  if (top) {
    const result = await monographImpact(db, top.id, { maxDepth: 3 });
    impact = {
      nodeId: top.id,
      name: top.name,
      riskLevel: result.riskLevel,
      riskScore: result.riskScore,
      affectedFiles: result.affectedFiles,
      affectedTests: result.affectedTests,
    };
  }
  return { task, relevant: entryPoints.length + docs.length > 0, entryPoints, docs, impact };
}
