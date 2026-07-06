import type { MonographDb } from '../storage/db.js';
/**
 * Detect dead code: exported top-level functions with zero inbound references.
 *
 * Limited to Function nodes only — the graph tracks CALLS edges for functions
 * but has near-zero coverage for Interface/TypeAlias/Class usage.
 *
 * Filters:
 * - Only top-level functions (File CONTAINS node) — skips nested closures
 * - Only exported — private locals are internal by design
 * - Skips entry-point, test, dist, and node_modules paths
 * - Requires zero inbound CALLS, IMPORTS, REFERENCES, and RE_EXPORTS edges
 * - No same-name node in another file (catches import bindings)
 * - Not re-exported through any index.ts barrel file
 */
export declare function detectDeadCode(db: MonographDb): string[];
export interface DeadCodeNode {
    id: string;
    name: string;
    filePath: string | null;
    startLine: number | null;
    label: string;
}
export declare function detectDeadCodeNodes(db: MonographDb): DeadCodeNode[];
/**
 * Format dead-code nodes as structured text for LLM consumption.
 * Each entry includes a file:line navigation hint where available.
 *
 * @param nodes - Result from detectDeadCodeNodes()
 * @returns Multi-line string suitable for injection into LLM context
 */
export declare function formatDeadCode(nodes: DeadCodeNode[]): string;
//# sourceMappingURL=dead-code.d.ts.map