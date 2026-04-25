/**
 * DLQ Reader (Task 37)
 *
 * Reads, filters, and purges DLQ entries from JSONL storage.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { DLQEntry, DLQEntryStatus } from '../../../shared/src/types/dlq.js';

/** Options for listing DLQ entries */
export interface DLQListOptions {
  status?: DLQEntryStatus;
  toolName?: string;
  agentId?: string;
  olderThanDays?: number;
  limit?: number;
}

export class DLQReader {
  constructor(private readonly filePath: string) {}

  /** Read all entries from the JSONL file */
  private readAll(): DLQEntry[] {
    if (!existsSync(this.filePath)) return [];
    const raw = readFileSync(this.filePath, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').map((line) => JSON.parse(line) as DLQEntry);
  }

  /** Write all entries back (used for purge) */
  private writeAll(entries: DLQEntry[]): void {
    const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    writeFileSync(this.filePath, content, 'utf-8');
  }

  /** List entries with optional filters (defaults to status='pending') */
  list(opts: DLQListOptions = {}): DLQEntry[] {
    const status = opts.status ?? 'pending';
    let entries = this.readAll().filter((e) => e.status === status);

    if (opts.toolName) {
      entries = entries.filter((e) => e.toolName === opts.toolName);
    }
    if (opts.agentId) {
      entries = entries.filter((e) => e.agentId === opts.agentId);
    }
    if (opts.olderThanDays !== undefined) {
      const cutoff = Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000;
      entries = entries.filter((e) => new Date(e.createdAt).getTime() < cutoff);
    }
    if (opts.limit !== undefined) {
      entries = entries.slice(0, opts.limit);
    }
    return entries;
  }

  /** Get a single entry by messageId */
  get(messageId: string): DLQEntry | null {
    return this.readAll().find((e) => e.messageId === messageId) ?? null;
  }

  /** Purge old pending entries (mark as 'purged') */
  purge(olderThanDays: number): number {
    const entries = this.readAll();
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let count = 0;

    for (const entry of entries) {
      if (entry.status === 'pending' && new Date(entry.createdAt).getTime() < cutoff) {
        entry.status = 'purged';
        count++;
      }
    }

    this.writeAll(entries);
    return count;
  }
}
