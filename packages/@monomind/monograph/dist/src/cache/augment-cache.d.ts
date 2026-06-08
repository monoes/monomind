export interface AugmentCacheOptions {
    maxSize?: number;
    ttlMs?: number;
}
export interface AugmentCache {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    size(): number;
    clear(): void;
    makeKey(query: string, repoPath: string, topK: number, format: string): string;
}
export declare function createAugmentCache(options?: AugmentCacheOptions): AugmentCache;
export declare const globalAugmentCache: AugmentCache;
//# sourceMappingURL=augment-cache.d.ts.map