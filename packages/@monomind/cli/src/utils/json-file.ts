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

import { readFileSync, writeFileSync, renameSync, existsSync, statSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Read and parse a JSON file. Returns `fallback` if file doesn't exist,
 * exceeds maxBytes, or fails to parse.
 */
export function readJsonFileSync<T>(
  filePath: string,
  fallback: T,
  maxBytes = 50 * 1024 * 1024,
): T {
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
 * Atomically write a JSON value to disk.
 *
 * Writes to a temporary file first (PID + timestamp suffix to avoid
 * collisions), then renames into place. Ensures the directory exists.
 */
export function writeJsonFileAtomic(
  filePath: string,
  data: unknown,
  pretty = true,
): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}
