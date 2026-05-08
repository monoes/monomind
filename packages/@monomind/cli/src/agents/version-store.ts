/**
 * Agent Version Store (Task 29)
 *
 * JSONL-based append-only storage for agent definition versions.
 * Supports save, list, get, rollback, and diff operations.
 */

import { createHash, randomUUID, randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import type { AgentVersionRecord, DiffResult } from '../../../shared/src/types/agent-version.js';
import { computeUnifiedDiff } from './version-diff.js';
import { parseJsonl } from '../utils/parse-jsonl.js';

/** Internal JSON-serializable shape stored in JSONL */
interface StoredRecord {
  id: string;
  slug: string;
  version: string;
  changelog: string;
  deprecated: boolean;
  deprecatedBy?: string;
  content: string;
  contentHash: string;
  capturedAt: string; // ISO string
  capturedBy: string;
  isCurrent: boolean;
}

function toStored(r: AgentVersionRecord): StoredRecord {
  return {
    id: r.id,
    slug: r.slug,
    version: r.version,
    changelog: r.changelog,
    deprecated: r.deprecated,
    deprecatedBy: r.deprecatedBy,
    content: r.content,
    contentHash: r.contentHash,
    capturedAt:
      r.capturedAt instanceof Date
        ? r.capturedAt.toISOString()
        : String(r.capturedAt),
    capturedBy: r.capturedBy,
    isCurrent: r.isCurrent,
  };
}

function fromStored(s: StoredRecord): AgentVersionRecord {
  return {
    id: s.id,
    slug: s.slug,
    version: s.version,
    changelog: s.changelog,
    deprecated: s.deprecated,
    deprecatedBy: s.deprecatedBy,
    content: s.content,
    contentHash: s.contentHash,
    capturedAt: new Date(s.capturedAt),
    capturedBy: s.capturedBy,
    isCurrent: s.isCurrent,
  };
}

/**
 * JSONL-based agent version store.
 *
 * Each slug's versions are stored in `<dirPath>/versions.jsonl`, one JSON
 * object per line.  Rollback rewrites the file to update `isCurrent` flags.
 */
export class AgentVersionStore {
  private readonly filePath: string;

  constructor(private readonly dirPath: string) {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
    this.filePath = join(dirPath, 'versions.jsonl');
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private readAll(): AgentVersionRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    const stat = statSync(this.filePath);
    if (stat.size > 10 * 1024 * 1024) {
      throw new Error('Version store exceeds size limit; run compaction');
    }
    const raw = readFileSync(this.filePath, 'utf-8');
    // Drop any record whose stored contentHash does not match the SHA-256 of
    // its content. saveVersion advertises tamper-evidence by computing the
    // hash; without this verification step, an attacker who can write the
    // JSONL file can swap `content` with a poisoned agent prompt while
    // leaving `contentHash` unchanged, and the next getCurrent() returns
    // the tampered prompt verbatim into the LLM context.
    const records = parseJsonl<StoredRecord>(raw);
    const verified: StoredRecord[] = [];
    for (const r of records) {
      if (typeof r?.content !== 'string' || typeof r?.contentHash !== 'string') continue;
      const actual = createHash('sha256').update(r.content).digest('hex');
      if (actual !== r.contentHash) continue; // silently drop tampered record
      verified.push(r);
    }
    return verified.map(fromStored);
  }

  private writeAll(records: AgentVersionRecord[]): void {
    const lines = records.map((r) => JSON.stringify(toStored(r)));
    const tmp = `${this.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(tmp, lines.join('\n') + '\n', 'utf-8');
    renameSync(tmp, this.filePath);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Save a new version for the given agent slug.
   *
   * Computes a SHA-256 hash of the content, marks all previous versions for
   * the same slug as non-current, and appends the new record.
   */
  saveVersion(
    slug: string,
    content: string,
    version: string,
    changelog: string,
    opts: {
      deprecated?: boolean;
      deprecatedBy?: string;
      capturedBy?: string;
    } = {},
  ): AgentVersionRecord {
    const contentHash = createHash('sha256').update(content).digest('hex');

    // SINGLE-WRITER CONTRACT: version-store is written only by the daemon process.
    // Concurrent saveVersion() calls from multiple processes would race on readAll/writeAll.
    // If multi-writer access is needed in future, introduce an advisory lock here.
    const existing = this.readAll();
    for (const rec of existing) {
      if (rec.slug === slug && rec.isCurrent) {
        rec.isCurrent = false;
      }
    }

    const record: AgentVersionRecord = {
      id: randomUUID(),
      slug,
      version,
      changelog,
      deprecated: opts.deprecated ?? false,
      deprecatedBy: opts.deprecatedBy,
      content,
      contentHash,
      capturedAt: new Date(),
      capturedBy: opts.capturedBy ?? 'system',
      isCurrent: true,
    };

    existing.push(record);
    this.writeAll(existing);
    return record;
  }

  /**
   * List all versions for a slug, sorted by capturedAt DESC (newest first).
   * Uses insertion order (line index) as a stable tiebreaker.
   */
  listVersions(slug: string): AgentVersionRecord[] {
    const all = this.readAll();
    const indexed = all.map((r, i) => ({ r, i }));
    return indexed
      .filter(({ r }) => r.slug === slug)
      .sort((a, b) => {
        const timeDiff =
          new Date(b.r.capturedAt).getTime() -
          new Date(a.r.capturedAt).getTime();
        return timeDiff !== 0 ? timeDiff : b.i - a.i;
      })
      .map(({ r }) => r);
  }

  /**
   * Get the current active version for a slug, or null.
   */
  getCurrent(slug: string): AgentVersionRecord | null {
    const all = this.readAll();
    const indexed = all.map((r, i) => ({ r, i }));
    const matching = indexed.filter(
      ({ r }) => r.slug === slug && r.isCurrent,
    );
    if (matching.length === 0) return null;
    // Return the most recent current record (insertion order as tiebreaker)
    return matching.sort((a, b) => {
      const timeDiff =
        new Date(b.r.capturedAt).getTime() -
        new Date(a.r.capturedAt).getTime();
      return timeDiff !== 0 ? timeDiff : b.i - a.i;
    })[0].r;
  }

  /**
   * Get a specific version by slug and semver string, or null.
   */
  getVersion(slug: string, version: string): AgentVersionRecord | null {
    return (
      this.readAll().find(
        (r) => r.slug === slug && r.version === version,
      ) ?? null
    );
  }

  /**
   * Roll back to a specific version.
   *
   * Marks the target version as current and all others for that slug as
   * non-current.  Rewrites the JSONL file.
   *
   * @throws Error if the target version does not exist.
   */
  rollback(slug: string, toVersion: string): AgentVersionRecord {
    const all = this.readAll();
    let target: AgentVersionRecord | undefined;

    for (const rec of all) {
      if (rec.slug === slug) {
        if (rec.version === toVersion) {
          rec.isCurrent = true;
          target = rec;
        } else {
          rec.isCurrent = false;
        }
      }
    }

    if (!target) {
      throw new Error(
        `Version "${toVersion}" not found for agent "${slug}"`,
      );
    }

    this.writeAll(all);
    return target;
  }

  /**
   * Compute a line-level diff between two versions of the same agent.
   *
   * @throws Error if either version does not exist.
   */
  diff(slug: string, fromVersion: string, toVersion: string): DiffResult {
    const from = this.getVersion(slug, fromVersion);
    if (!from) {
      throw new Error(
        `Version "${fromVersion}" not found for agent "${slug}"`,
      );
    }
    const to = this.getVersion(slug, toVersion);
    if (!to) {
      throw new Error(
        `Version "${toVersion}" not found for agent "${slug}"`,
      );
    }

    const { additions, deletions, hunks } = computeUnifiedDiff(
      from.content,
      to.content,
    );

    return {
      slug,
      fromVersion,
      toVersion,
      additions,
      deletions,
      hunks,
    };
  }
}
