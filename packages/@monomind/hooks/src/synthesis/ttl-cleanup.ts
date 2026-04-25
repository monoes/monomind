/**
 * TTL Cleanup — Task 47
 *
 * Handles expiration-based cleanup of ephemeral synthesized agents.
 * Never deletes promoted agents.
 */

import { unlink, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { EphemeralAgentRecord, CleanupResult } from './types.js';
import type { EphemeralRegistry } from './ephemeral-registry.js';

export class TTLCleanup {
  private agentDir: string;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  /**
   * Delete all expired, non-promoted agents from registry and disk.
   */
  async runCleanup(registry: EphemeralRegistry): Promise<CleanupResult> {
    const expired = registry.listExpired();
    const deletedSlugs: string[] = [];
    let skippedPromoted = 0;

    for (const record of expired) {
      // Double-check promotion (belt-and-suspenders)
      if (record.promoted) {
        skippedPromoted++;
        continue;
      }

      try {
        await unlink(record.filePath);
      } catch {
        // File may already be gone — that's fine
      }

      registry.remove(record.slug);
      deletedSlugs.push(record.slug);
    }

    const orphans = await this.findOrphans(registry);

    return {
      deletedCount: deletedSlugs.length,
      deletedSlugs,
      skippedPromoted,
      orphansFound: orphans.length,
    };
  }

  /**
   * Extend the TTL of an existing record.
   */
  extendTTL(record: EphemeralAgentRecord, extensionMs: number): EphemeralAgentRecord {
    const newExpiry = new Date(record.expiresAt.getTime() + extensionMs);
    return { ...record, expiresAt: newExpiry };
  }

  /**
   * Find .md files in the agent directory that have no matching registry entry.
   * These are orphans left behind by incomplete cleanup.
   */
  async findOrphans(registry: EphemeralRegistry): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.agentDir);
    } catch {
      return [];
    }

    const mdFiles = files.filter(f => f.endsWith('.md'));
    const orphans: string[] = [];

    for (const file of mdFiles) {
      const slug = basename(file, '.md');
      if (!registry.isRegistered(slug)) {
        orphans.push(join(this.agentDir, file));
      }
    }

    return orphans;
  }
}
