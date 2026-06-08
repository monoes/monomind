import type { MonographDb } from './db.js';
export interface FileCacheEntry {
    filePath: string;
    contentHash: string;
    lastParsed: number;
    nodeCount: number;
    edgeCount: number;
}
export declare function hashFileContent(content: string): string;
export declare function isFileCached(db: MonographDb, filePath: string, contentHash: string): boolean;
export declare function updateFileCache(db: MonographDb, entry: FileCacheEntry): void;
export declare function getFileCacheStats(db: MonographDb): {
    totalCached: number;
    hitRate: number;
    stalePaths: string[];
};
export declare function clearFileCache(db: MonographDb): void;
//# sourceMappingURL=file-cache.d.ts.map