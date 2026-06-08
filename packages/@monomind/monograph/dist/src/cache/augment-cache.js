export function createAugmentCache(options = {}) {
    const { maxSize = 100, ttlMs = 5 * 60 * 1000 } = options;
    const store = new Map();
    function evictExpired() {
        const now = Date.now();
        for (const [k, v] of store) {
            if (v.expiresAt <= now)
                store.delete(k);
        }
    }
    function evictOldest() {
        const first = store.keys().next().value;
        if (first !== undefined)
            store.delete(first);
    }
    return {
        get(key) {
            const entry = store.get(key);
            if (!entry)
                return undefined;
            if (entry.expiresAt <= Date.now()) {
                store.delete(key);
                return undefined;
            }
            return entry.value;
        },
        set(key, value) {
            evictExpired();
            if (store.size >= maxSize)
                evictOldest();
            store.set(key, { value, expiresAt: Date.now() + ttlMs });
        },
        size() {
            evictExpired();
            return store.size;
        },
        clear() {
            store.clear();
        },
        makeKey(query, repoPath, topK, format) {
            return `${repoPath}\0${topK}\0${format}\0${query}`;
        },
    };
}
export const globalAugmentCache = createAugmentCache({ maxSize: 200, ttlMs: 5 * 60 * 1000 });
//# sourceMappingURL=augment-cache.js.map