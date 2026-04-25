/**
 * Pure reducer functions for SwarmState field merging.
 * Each reducer takes two values and returns a merged result.
 * Used by StateManager to resolve concurrent writes.
 */

import type { ConsensusVote } from './swarm-state.js';

/**
 * Concatenate two arrays.
 */
export function appendReducer<T>(a: T[], b: T[]): T[] {
  return [...a, ...b];
}

/**
 * Return the second (newest) value, discarding the first.
 */
export function lastWriteReducer<T>(_a: T, b: T): T {
  return b;
}

/**
 * Deduplicate merged arrays.
 * For primitives, uses Set-based dedup.
 * For objects, deduplicates by the given key.
 */
export function mergeUniqueReducer<T>(a: T[], b: T[], key?: keyof T): T[] {
  const combined = [...a, ...b];
  if (key !== undefined) {
    const seen = new Map<unknown, T>();
    for (const item of combined) {
      const k = (item as Record<string, unknown>)[key as string];
      seen.set(k, item);
    }
    return Array.from(seen.values());
  }
  return Array.from(new Set(combined));
}

/**
 * Deep merge two plain objects. `b` wins for non-object values.
 */
export function deepMergeReducer(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...a };
  for (const k of Object.keys(b)) {
    const aVal = a[k];
    const bVal = b[k];
    if (
      aVal !== null &&
      bVal !== null &&
      typeof aVal === 'object' &&
      typeof bVal === 'object' &&
      !Array.isArray(aVal) &&
      !Array.isArray(bVal)
    ) {
      result[k] = deepMergeReducer(
        aVal as Record<string, unknown>,
        bVal as Record<string, unknown>,
      );
    } else {
      result[k] = bVal;
    }
  }
  return result;
}

/**
 * Merge two ConsensusVote values. Higher term wins; if equal, committed wins.
 */
export function raftMergeReducer(
  a: ConsensusVote | null,
  b: ConsensusVote | null,
): ConsensusVote | null {
  if (a === null) return b;
  if (b === null) return a;

  const termA = a.term ?? 0;
  const termB = b.term ?? 0;

  if (termB > termA) return b;
  if (termA > termB) return a;

  // Equal terms: committed wins
  if (b.committed && !a.committed) return b;
  if (a.committed && !b.committed) return a;

  // Otherwise b (latest write) wins
  return b;
}

/**
 * Registry mapping reducer names to their functions.
 */
export const REDUCERS: Record<string, (...args: unknown[]) => unknown> = {
  append: appendReducer as (...args: unknown[]) => unknown,
  last_write: lastWriteReducer as (...args: unknown[]) => unknown,
  merge_unique: mergeUniqueReducer as (...args: unknown[]) => unknown,
  deep_merge: deepMergeReducer as (...args: unknown[]) => unknown,
  raft_merge: raftMergeReducer as (...args: unknown[]) => unknown,
};
