import type { MonographEdge, EdgeRelation, EdgeConfidence } from '../types.js';
import type { MonographDb } from '../storage/db.js';
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
/**
 * Query edges from a MonographDb with optional relation / confidence filters.
 * All filters are combined with AND.
 */
export declare function filterEdges(db: MonographDb, options?: EdgeFilterOptions): MonographEdge[];
/**
 * Filter an already-loaded array of edges in memory.
 * Useful when the caller already has edges and does not need a DB round-trip.
 */
export declare function filterEdgesInMemory(edges: MonographEdge[], options?: EdgeFilterOptions): MonographEdge[];
//# sourceMappingURL=edge-filter.d.ts.map