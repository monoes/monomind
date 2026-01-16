/**
 * ActionRecordStore — JSONL-backed append-only store for action records.
 *
 * Part of Task 45 — Procedural Memory.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ActionRecord } from './types.js';

export class ActionRecordStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** Append a single action record to the JSONL file */
  record(rec: ActionRecord): void {
    appendFileSync(this.filePath, JSON.stringify(rec) + '\n', 'utf-8');
  }

  /** Read all records from the JSONL file */
  private readAll(): ActionRecord[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line) as ActionRecord);
  }

  /** Query records by agent slug, optionally filtering by lookback days */
  queryByAgentSlug(slug: string, lookbackDays?: number): ActionRecord[] {
    const all = this.readAll();
    const cutoff = lookbackDays
      ? new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    return all.filter((r) => {
      if (r.agentSlug !== slug) return false;
      if (cutoff && r.timestamp < cutoff) return false;
      return true;
    });
  }

  /** Get all records for a specific run, sorted by timestamp */
  getRunSequence(runId: string): ActionRecord[] {
    return this.readAll()
      .filter((r) => r.runId === runId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}
