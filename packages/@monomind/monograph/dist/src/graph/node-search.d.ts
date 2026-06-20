import type { MonographNode, NodeLabel } from '../types.js';
import type { MonographDb } from '../storage/db.js';
export interface NodeSearchOptions {
    /** Filter by node label (e.g. 'Function', 'Class'). */
    label?: NodeLabel;
    /** Filter by programming language (case-insensitive). */
    language?: string;
    /** Filter by file extension, e.g. '.ts', 'ts' (leading dot optional). */
    fileExtension?: string;
    /** Filter by file path substring (case-insensitive). */
    filePath?: string;
    /** Only return exported nodes. */
    isExported?: boolean;
    /** Only return nodes inside this community. */
    communityId?: number;
    /** Maximum number of results (default: no limit). */
    limit?: number;
}
/**
 * Search nodes by structured property criteria.
 * All supplied criteria are combined with AND.
 *
 * Prepared statements are cached per-DB keyed by the active condition set so
 * repeated calls with the same filter shape reuse the compiled statement.
 */
export declare function searchNodesByProperty(db: MonographDb, options?: NodeSearchOptions): MonographNode[];
/**
 * Filter an already-loaded array of nodes in memory.
 */
export declare function searchNodesInMemory(nodes: MonographNode[], options?: NodeSearchOptions): MonographNode[];
//# sourceMappingURL=node-search.d.ts.map