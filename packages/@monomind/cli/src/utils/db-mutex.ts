import { resolve } from 'node:path';

const locks = new Map<string, Promise<unknown>>();

/**
 * Serialize sql.js read-modify-write cycles per database path within this
 * process.  Callers that load a .db file, mutate it in WASM, then export+
 * rename must wrap the entire cycle in this lock so concurrent MCP tool
 * calls don't each load a stale copy (last writer wins = data loss).
 *
 * Only protects within a single Node process — cross-process races need
 * file locking, which is a separate concern.
 */
export function withDbLock<T>(dbPath: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(dbPath);
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next);
  next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  });
  return next;
}
