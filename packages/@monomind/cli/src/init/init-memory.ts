/**
 * Memory database setup for `monomind init`.
 *
 * Does what `monomind memory init` does — create `.swarm/memory.db` and copy
 * it to `.claude/memory.db` — but idempotently: an existing database is left
 * exactly as it is, never recreated.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initializeMemoryDatabase } from '../memory/memory-initializer.js';
import { output } from '../output.js';
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
