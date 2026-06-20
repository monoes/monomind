import type { MonographDb } from '../storage/db.js';
/**
 * Detect dead code: nodes that have in-degree 0 AND are not marked as exported.
 *
 * In a module dependency graph, a node with in-degree 0 is never imported by
 * any other module. If it is also not explicitly exported (i.e., not an entry-point),
 * it is considered dead code — unreachable and unused.
 *
 * @param db - The MonographDb instance
 * @returns Array of node ids that are considered dead code.
 */
export declare function detectDeadCode(db: MonographDb): string[];
export interface DeadCodeNode {
    id: string;
    name: string;
    filePath: string | null;
    startLine: number | null;
    label: string;
}
/**
 * Like detectDeadCode() but returns rich node objects with filePath and
 * startLine so callers can render file:line navigation hints.
 *
 * @param db - The MonographDb instance
 * @returns Array of dead-code nodes with location metadata.
 */
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