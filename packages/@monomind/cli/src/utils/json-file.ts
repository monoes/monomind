/**
 * Shared atomic JSON file I/O utility.
 *
 * Previously duplicated across 10+ files with the same
 * writeFileSync(tmp) + renameSync(tmp, path) pattern:
 *   - mcp-tools/neural-tools.ts
 *   - memory/intelligence.ts
 *   - autopilot-state.ts
 *   - commands/claims.ts
 *   - commands/swarm.ts
 *   - commands/neural-optimize.ts
 *   - commands/neural-registry.ts
 *   - commands/agent-lifecycle.ts
 *   - commands/memory-admin.ts
 *   - commands/memory-list.ts
 *   - commands/security-cve.ts
 *
 * This is the single canonical implementation. Uses atomic
 * rename to prevent partial writes on crash.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Read and parse a JSON file. Returns `fallback` if file doesn't exist,
 * exceeds maxBytes, or fails to parse.
 */
export function readJsonFileSync<T>(filePath: string, fallback: T, maxBytes = 50 * 1024 * 1024): T {
  try {
    if (!existsSync(filePath)) return fallback;
    const stat = statSync(filePath);
    if (stat.size > maxBytes) return fallback;
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Hardened JSON store loader that distinguishes "absent" from "corrupt".
 *
 * - File absent → returns `emptyDefault` (safe to build on and save back)
 * - File present and valid → returns the parsed value
 * - File present but corrupt/oversized/__proto__ → returns null
 *
 * Write handlers MUST use this and bail on null — otherwise a transient
 * read failure silently wipes the store on the next save.
 */
export function readJsonStoreOrNull<T>(
  filePath: string,
  emptyDefault: T,
  label: string,
  maxBytes = 50 * 1024 * 1024,
): T | null {
  try {
    if (!existsSync(filePath)) return emptyDefault;
    if (statSync(filePath).size > maxBytes) return null;
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, '__proto__')) return null;
    return parsed;
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error(`[${label}] store unreadable/corrupt — refusing to proceed:`, e);
    return null;
  }
}

/**
 * Atomically write a JSON value to disk.
 *
 * Writes to a temporary file first (PID + timestamp suffix to avoid
 * collisions), then renames into place. Ensures the directory exists.
 */
export function writeJsonFileAtomic(filePath: string, data: unknown, pretty = true): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Merge `incoming` records into `existing` by `id`, keeping existing records
 * in place and appending only the ones not already present. Shared by
 * `hooks intelligence import` (file pattern import) and `hooks transfer`
 * (cross-project pattern transfer) so both use one dedupe rule.
 */
export function mergeRecordsById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
): { merged: T[]; added: T[] } {
  const existingIds = new Set(existing.map((r) => r.id));
  const added = incoming.filter((r) => !existingIds.has(r.id));
  return { merged: [...existing, ...added], added };
}
