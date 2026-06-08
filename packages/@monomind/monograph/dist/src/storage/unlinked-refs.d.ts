import type Database from 'better-sqlite3';
export interface UnlinkedReference {
    sourceId: string;
    sourceName: string;
    sourceFilePath: string | null;
    sourceLabel: string;
    targetName: string;
    mentionContext: string | null;
    confidence: 'high' | 'medium' | 'low';
}
/**
 * Find nodes that mention a target symbol by name in their metadata
 * (summary, file_path, norm_label) but have no explicit edge to any node
 * with that name. These are "mentioned but not linked" — latent coupling.
 *
 * @param db - open monograph database
 * @param targetName - symbol name to search for (e.g. "UserService")
 * @param options.limit - max results (default 50)
 * @param options.excludeSourceId - skip this node id (avoid self-match)
 */
export declare function findUnlinkedReferences(db: Database.Database, targetName: string, options?: {
    limit?: number;
    excludeSourceId?: string;
}): UnlinkedReference[];
//# sourceMappingURL=unlinked-refs.d.ts.map