import type { MonographNode, MonographEdge } from '../types.js';
/**
 * Bump this whenever the parser/extractor output format changes in a way that
 * would make previously-cached nodes/edges stale or wrong (e.g. a parser bugfix,
 * a change to what symbols get extracted, a change to node/edge shape). Any
 * cached entry written under an older version is treated as a miss on read, so
 * bumping this effectively invalidates the entire on-disk extraction cache.
 */
export declare const EXTRACTION_CACHE_VERSION = 1;
export interface CacheEntry {
    fileHash: string;
    mtimeMs?: number;
    size?: number;
    nodes: MonographNode[];
    edges: MonographEdge[];
    /** Extraction format version this entry was written under — see EXTRACTION_CACHE_VERSION. */
    cacheVersion?: number;
}
export declare class ExtractionCache {
    private readonly dir;
    private pending;
    constructor(dir: string);
    hashFile(filePath: string): string;
    hashContent(content: string): string;
    private entryPath;
    /** tmp+rename write — cache corruption is low-stakes but a torn write from a
     * killed process still shouldn't poison the next read. */
    private writeAtomic;
    /**
     * Delete cache entries whose mtime exceeds maxAgeMs (default 30 days).
     * Covers files that were deleted/renamed (their cache entry is now orphaned
     * and would otherwise sit on disk forever) as well as entries simply not
     * touched in a long time. Single readdir + stat pass over the cache dir.
     * Returns the number of entries removed.
     */
    prune(maxAgeMs?: number): number;
    /**
     * Fast-path: check mtime+size before falling back to content hash.
     * Returns cached entry if file hasn't changed, null on miss.
     */
    getWithStat(filePath: string): CacheEntry | null;
    get(filePath: string, fileHash: string): CacheEntry | null;
    set(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void;
    setDeferred(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void;
    flush(): void;
}
//# sourceMappingURL=extraction-cache.d.ts.map