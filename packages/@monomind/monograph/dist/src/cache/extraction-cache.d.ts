import type { MonographNode, MonographEdge } from '../types.js';
export interface CacheEntry {
    fileHash: string;
    mtimeMs?: number;
    size?: number;
    nodes: MonographNode[];
    edges: MonographEdge[];
}
export declare class ExtractionCache {
    private readonly dir;
    private pending;
    constructor(dir: string);
    hashFile(filePath: string): string;
    hashContent(content: string): string;
    private entryPath;
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