/**
 * Memory database setup for `monomind init`.
 *
 * Does what `monomind memory init` does — create `.swarm/memory.db` and copy
 * it to `.claude/memory.db` — but idempotently: an existing database is left
 * exactly as it is, never recreated.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeMemoryDatabase, storeEntry } from '../memory/memory-initializer.js';
import { output } from '../output.js';
import type { MemorySeed } from './shared-instructions-generator.js';
import type { InitMemoryResult } from './types.js';

export async function initProjectMemory(
  cwd: string,
  options: { syncToClaude: boolean },
): Promise<InitMemoryResult> {
  const dbPath = path.join(cwd, '.swarm', 'memory.db');
  let status: InitMemoryResult['status'] = 'existing';
  try {
    if (!fs.existsSync(dbPath)) {
      const result = await initializeMemoryDatabase({ dbPath });
      if (!result.success) {
        return { status: 'failed', dbPath, error: result.error || 'unknown reason' };
      }
      status = 'created';
    }
    const claudeDbPath = path.join(cwd, '.claude', 'memory.db');
    if (options.syncToClaude && !fs.existsSync(claudeDbPath)) {
      fs.mkdirSync(path.dirname(claudeDbPath), { recursive: true });
      fs.copyFileSync(dbPath, claudeDbPath);
    }
    return { status, dbPath };
  } catch (e) {
    return { status: 'failed', dbPath, error: e instanceof Error ? e.message : String(e) };
  }
}

// Seed keys come from package.json's `name`; keep them to a plain shape.
const SEED_KEY = /^[a-zA-Z0-9._:/-]{1,128}$/;
const SEED_NAMESPACE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Store the seeds shared_instructions generation detected, in-process, in
 * `targetDir`'s memory store — the one `monomind memory store` run there
 * writes to, which the bridge resolves from MONOMIND_CWD (else the cwd), so
 * it is pinned to `targetDir` for the duration. Best-effort; returns how
 * many were stored. No embeddings are computed, so init neither loads a
 * model nor goes online.
 */
export async function seedProjectMemory(
  targetDir: string,
  seeds: readonly MemorySeed[],
): Promise<number> {
  const previousCwd = process.env.MONOMIND_CWD;
  process.env.MONOMIND_CWD = targetDir;
  let stored = 0;
  try {
    for (const { key, value, namespace } of seeds) {
      if (!SEED_KEY.test(key) || !SEED_NAMESPACE.test(namespace)) continue;
      try {
        const result = await storeEntry({
          key,
          value,
          namespace,
          generateEmbeddingFlag: false,
          upsert: true,
        });
        if (result.success) stored++;
      } catch {
        // Non-critical — memory seeding is best-effort
      }
    }
  } finally {
    if (previousCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = previousCwd;
  }
  return stored;
}

/** Print the outcome; a failure is a warning with the fix, never an error. */
export function reportProjectMemory(memory: InitMemoryResult | undefined): void {
  if (memory?.status === 'created') output.printInfo('◈ Memory database initialized');
  if (memory?.status === 'existing') output.printInfo('◈ Memory database already present — kept');
  if (memory?.status === 'failed') {
    output.printWarning(
      `Memory database not initialized (${memory.error}) — run \`monomind memory init\` to fix`,
    );
  }
}
