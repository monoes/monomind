/**
 * Shared lazy package loader with module-level cache.
 * Replaces the repeated `await import(pkg).catch(() => null)` pattern.
 *
 * Cache semantics:
 * - undefined: not attempted yet
 * - Promise: load in progress (deduplicates concurrent callers)
 * - null: load failed permanently (package absent or broken)
 * - T: load succeeded; the module object
 */

type CacheEntry<T> = T | null | Promise<T | null>;

const _cache = new Map<string, CacheEntry<unknown>>();

/**
 * Try to dynamically import a package. Returns the module or null.
 * Result is cached — repeated calls return instantly from cache.
 */
export async function tryLoad<T = Record<string, unknown>>(
  specifier: string
): Promise<T | null> {
  if (_cache.has(specifier)) {
    return (await _cache.get(specifier)) as T | null;
  }

  const promise = import(specifier).then(
    (mod) => mod as T,
    () => null
  );
  _cache.set(specifier, promise);

  const result = await promise;
  _cache.set(specifier, result); // replace promise with resolved value
  return result;
}

/**
 * Get the cached result synchronously.
 * Returns undefined if the load hasn't been attempted yet.
 * Returns null if the load was attempted and failed.
 */
export function getCached<T = Record<string, unknown>>(
  specifier: string
): T | null | undefined {
  const entry = _cache.get(specifier);
  if (entry === undefined) return undefined;
  if (entry instanceof Promise) return undefined; // still loading
  return entry as T | null;
}

/**
 * Clear all cached entries. Used in tests.
 */
export function clearCache(): void {
  _cache.clear();
}
