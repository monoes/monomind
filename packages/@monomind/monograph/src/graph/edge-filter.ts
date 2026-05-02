import type { MonographEdge, EdgeRelation, EdgeConfidence } from '../types.js';
import type { MonographDb } from '../storage/db.js';

// ── Filter options ─────────────────────────────────────────────────────────────

export interface EdgeFilterOptions {
  /** Only return edges whose relation matches one of these values. */
  relations?: EdgeRelation[];
  /** Only return edges whose confidence label matches one of these values. */
  confidences?: EdgeConfidence[];
  /** Only return edges with a confidence_score >= this value (0–1). */
  minConfidenceScore?: number;
  /** Only return edges with a confidence_score <= this value (0–1). */
  maxConfidenceScore?: number;
}

// ── DB-backed filter ───────────────────────────────────────────────────────────

/**
 * Query edges from a MonographDb with optional relation / confidence filters.
 * All filters are combined with AND.
 */
export function filterEdges(
  db: MonographDb,
  options: EdgeFilterOptions = {},
): MonographEdge[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.relations && options.relations.length > 0) {
    const ph = options.relations.map(() => '?').join(',');
    conditions.push(`relation IN (${ph})`);
    params.push(...options.relations);
  }

  if (options.confidences && options.confidences.length > 0) {
    const ph = options.confidences.map(() => '?').join(',');
    conditions.push(`confidence IN (${ph})`);
    params.push(...options.confidences);
  }

  if (options.minConfidenceScore !== undefined) {
    conditions.push('confidence_score >= ?');
    params.push(options.minConfidenceScore);
  }

  if (options.maxConfidenceScore !== undefined) {
    conditions.push('confidence_score <= ?');
    params.push(options.maxConfidenceScore);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT id, source_id, target_id, relation, confidence, confidence_score, reason, evidence
               FROM edges ${where}`;

  const rows = db.prepare(sql).all(...params) as {
    id: string;
    source_id: string;
    target_id: string;
    relation: string;
    confidence: string;
    confidence_score: number;
    reason: string | null;
    evidence: string | null;
  }[];

  return rows.map(r => ({
    id: r.id,
    sourceId: r.source_id,
    targetId: r.target_id,
    relation: r.relation as EdgeRelation,
    confidence: r.confidence as EdgeConfidence,
    confidenceScore: r.confidence_score,
    reason: r.reason ?? undefined,
  }));
}

// ── In-memory filter ───────────────────────────────────────────────────────────

/**
 * Filter an already-loaded array of edges in memory.
 * Useful when the caller already has edges and does not need a DB round-trip.
 */
export function filterEdgesInMemory(
  edges: MonographEdge[],
  options: EdgeFilterOptions = {},
): MonographEdge[] {
  return edges.filter(e => {
    if (options.relations && options.relations.length > 0) {
      if (!options.relations.includes(e.relation)) return false;
    }
    if (options.confidences && options.confidences.length > 0) {
      if (!options.confidences.includes(e.confidence)) return false;
    }
    if (options.minConfidenceScore !== undefined && e.confidenceScore < options.minConfidenceScore) {
      return false;
    }
    if (options.maxConfidenceScore !== undefined && e.confidenceScore > options.maxConfidenceScore) {
      return false;
    }
    return true;
  });
}
