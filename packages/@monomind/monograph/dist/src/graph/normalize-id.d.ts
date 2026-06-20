/**
 * Normalized-ID edge reconciliation.
 *
 * Mirrors graphify's `_normalize_id` / `norm_to_id` logic:
 * when an LLM-generated edge endpoint ID does not exactly match any node ID
 * in the graph, we try a normalized form (lowercase, non-alphanumeric → '_').
 * This lets edges survive across minor casing / punctuation mismatches between
 * the AST extractor and the LLM.
 */
/**
 * Normalise an ID string the same way graphify's `_normalize_id` does.
 *
 * Replaces all runs of non-alphanumeric characters with a single underscore,
 * strips leading/trailing underscores, and lowercases the result.
 *
 * @example
 * normalizeId('Session_ValidateToken') // 'session_validatetoken'
 * normalizeId('My-Class::method')      // 'my_class_method'
 */
export declare function normalizeId(id: string): string;
/**
 * Build a Map from normalised id → canonical id from a set of known node ids.
 * Used during edge reconciliation to remap mismatched endpoints.
 *
 * @param nodeIds - The authoritative set of node ids.
 * @returns Map of `normalizeId(id)` → original `id`.
 */
export declare function buildNormToIdMap(nodeIds: Iterable<string>): Map<string, string>;
export interface RawEdge {
    source: string;
    target: string;
    [key: string]: unknown;
}
export interface ReconciliationResult {
    /** Edges whose endpoints were resolved (possibly with normalization). */
    resolved: RawEdge[];
    /** Edges that could not be matched even after normalization. */
    dangling: RawEdge[];
    /** Number of edges that required normalization to resolve. */
    remappedCount: number;
}
/**
 * Reconcile a list of raw edges against a known set of node ids.
 *
 * For each edge:
 * 1. If both endpoints are in `nodeIds` → resolved as-is.
 * 2. If an endpoint is missing, try `normalizeId(endpoint)` lookup.
 * 3. If still missing → moved to `dangling` (not added to the graph).
 *
 * Mutates `source`/`target` fields on resolved edges in-place when remapping.
 */
export declare function reconcileEdges(edges: RawEdge[], nodeIds: Set<string>): ReconciliationResult;
/**
 * Format a ReconciliationResult as structured text for LLM consumption.
 */
export declare function formatReconciliationResult(result: ReconciliationResult): string;
//# sourceMappingURL=normalize-id.d.ts.map