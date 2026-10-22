const store = new Map<string, string>();
export function cacheResponse(key: string, body: string): void {
  store.set(key, body);
}
export function lookupCachedResponse(key: string): string | undefined {
  return store.get(key);
}
