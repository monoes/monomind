/**
 * Normalized-ID edge reconciliation.
 *
 * Mirrors graphify's `_normalize_id` / `norm_to_id` logic:
 * when an LLM-generated edge endpoint ID does not exactly match any node ID
 * in the graph, we try a normalized form (lowercase, non-alphanumeric → '_').
 * This lets edges survive across minor casing / punctuation mismatches between
 * the AST extractor and the LLM.
 */

// ── Core normaliser ────────────────────────────────────────────────────────────

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
export function normalizeId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// ── Lookup map builder ─────────────────────────────────────────────────────────

/**
 * Build a Map from normalised id → canonical id from a set of known node ids.
 * Used during edge reconciliation to remap mismatched endpoints.
 *
 * @param nodeIds - The authoritative set of node ids.
 * @returns Map of `normalizeId(id)` → original `id`.
 */
export function buildNormToIdMap(nodeIds: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of nodeIds) {
    map.set(normalizeId(id), id);
  }
  return map;
}

// ── Edge reconciliation ────────────────────────────────────────────────────────

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
export function reconcileEdges(
  edges: RawEdge[],
  nodeIds: Set<string>,
): ReconciliationResult {
  const normToId = buildNormToIdMap(nodeIds);

  const resolved: RawEdge[] = [];
  const dangling: RawEdge[] = [];
  let remappedCount = 0;

  for (const edge of edges) {
    let src = edge.source;
    let tgt = edge.target;
    let remapped = false;

    if (!nodeIds.has(src)) {
      const canonical = normToId.get(normalizeId(src));
      if (canonical) {
        src = canonical;
        remapped = true;
      }
    }

    if (!nodeIds.has(tgt)) {
      const canonical = normToId.get(normalizeId(tgt));
      if (canonical) {
        tgt = canonical;
        remapped = true;
      }
    }

    if (nodeIds.has(src) && nodeIds.has(tgt)) {
      resolved.push({ ...edge, source: src, target: tgt });
      if (remapped) remappedCount++;
    } else {
      dangling.push(edge);
    }
  }

  return { resolved, dangling, remappedCount };
}
