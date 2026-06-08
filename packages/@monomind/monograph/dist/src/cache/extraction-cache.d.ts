import type { MonographNode, MonographEdge } from '../types.js';
export interface CacheEntry {
    fileHash: string;
    nodes: MonographNode[];
    edges: MonographEdge[];
}
/**
 * SHA256-keyed per-file extraction cache.
 * Stores parsed nodes and edges keyed by file content hash so unchanged
 * files skip reparsing on subsequent monograph build runs.
 *
 * Cache files are stored in `dir` as `<sha256(filePath)>.json`.
 * A cache hit requires the stored `fileHash` to match the provided hash.
 *
 * TODO: Integrate into pipeline runner once per-file phase iteration is
 * exposed — currently PipelineRunner delegates file iteration to individual
 * phases (e.g. parse phase), so the cache hook point lives inside the parse
 * phase execute() method rather than in runner.ts.
 */
export declare class ExtractionCache {
    private readonly dir;
    constructor(dir: string);
    /** Compute SHA256 hex digest of a file's contents. */
    hashFile(filePath: string): string;
    private entryPath;
    /**
     * Retrieve a cache entry for the given file path and hash.
     * Returns null on cache miss (file not cached or hash mismatch).
     */
    get(filePath: string, fileHash: string): CacheEntry | null;
    /** Store parsed nodes and edges for a file path + hash. */
    set(filePath: string, fileHash: string, nodes: MonographNode[], edges: MonographEdge[]): void;
}
//# sourceMappingURL=extraction-cache.d.ts.map