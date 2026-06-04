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
  // Native kill-switch — force-skip all native package loads. tryLoad() is only
  // used for optional native @monoes deps, so gating everything here is safe.
  if (process.env.MONOMIND_DISABLE_NATIVE === '1' || process.env.MONOMIND_FORCE_JS === '1') {
    _cache.set(specifier, null);
    return null;
  }

  if (_cache.has(specifier)) {
    return (await _cache.get(specifier)) as T | null;
  }

  // Native @monoes packages are CJS .node bindings. Under `await import()`,
  // cjs-module-lexer can only statically expose named exports when the package's
  // index does a direct top-level `module.exports = require(...)`. Our platform
  // loaders assign through a conditional `let`, so the ESM namespace surfaces the
  // binding only on `.default`. Normalize that here so consumers (the capability
  // probes, neural features) read the real binding's named symbols uniformly,
  // regardless of whether the package resolves to a workspace file or a published
  // pnpm package. This is safe here because tryLoad is only used for the native
  // @monoes bindings and the pure-JS @monomind workspace deps probed in
  // capabilities.ts — none export a meaningful ESM `default` alongside named
  // exports that callers depend on, so unwrapping `default` never drops symbols.
  const promise = import(specifier).then(
    (mod) => {
      const m = mod as { default?: unknown } & T;
      return (m?.default ?? m) as T;
    },
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
