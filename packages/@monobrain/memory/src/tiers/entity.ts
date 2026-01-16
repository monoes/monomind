/**
 * EntityMemory — Named-entity key-value facts stored as JSON-lines (Task 09)
 *
 * Uses a simple `.jsonl` file for persistence (no native dependencies).
 * Each line is a JSON-serialised EntityFact. On mutation the full set is
 * rewritten — acceptable for the expected cardinality of entity facts.
 *
 * @module v1/memory/tiers/entity
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface EntityFact {
  entity: string;
  factType: string;
  value: string;
  confidence: number;
  sourceRunId: string;
  createdAt: number;
  expiresAt?: number;
}

export class EntityMemory {
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    // Ensure parent directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // ---- Mutation ----

  /**
   * Store (or upsert) a fact. If a fact with the same (entity, factType)
   * already exists it is replaced.
   */
  store(fact: EntityFact): void {
    const all = this.readAll();
    const idx = all.findIndex(
      (f) => f.entity === fact.entity && f.factType === fact.factType,
    );
    if (idx >= 0) {
      all[idx] = fact;
    } else {
      all.push(fact);
    }
    this.writeAll(all);
  }

  /**
   * Delete facts for an entity, optionally scoped to a factType.
   * Returns the number of facts removed.
   */
  delete(entity: string, factType?: string): number {
    const all = this.readAll();
    const remaining = all.filter((f) => {
      if (f.entity !== entity) return true;
      if (factType !== undefined && f.factType !== factType) return true;
      return false;
    });
    const removed = all.length - remaining.length;
    if (removed > 0) this.writeAll(remaining);
    return removed;
  }

  /** Remove all facts whose expiresAt is in the past. */
  pruneExpired(): number {
    const now = Date.now();
    const all = this.readAll();
    const remaining = all.filter(
      (f) => f.expiresAt === undefined || f.expiresAt > now,
    );
    const removed = all.length - remaining.length;
    if (removed > 0) this.writeAll(remaining);
    return removed;
  }

  // ---- Retrieval ----

  /**
   * Retrieve all non-expired facts for an entity,
   * sorted by confidence descending.
   */
  retrieve(entity: string): EntityFact[] {
    const now = Date.now();
    return this.readAll()
      .filter(
        (f) =>
          f.entity === entity &&
          (f.expiresAt === undefined || f.expiresAt > now),
      )
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** Return all non-expired facts of a given type. */
  findByFactType(factType: string): EntityFact[] {
    const now = Date.now();
    return this.readAll().filter(
      (f) =>
        f.factType === factType &&
        (f.expiresAt === undefined || f.expiresAt > now),
    );
  }

  // ---- Lifecycle ----

  /** No-op for file-based storage. */
  close(): void {
    // intentionally empty
  }

  // ---- Private helpers ----

  private readAll(): EntityFact[] {
    if (!existsSync(this.dbPath)) return [];
    const raw = readFileSync(this.dbPath, 'utf-8').trim();
    if (raw.length === 0) return [];
    return raw
      .split('\n')
      .map((line) => JSON.parse(line) as EntityFact);
  }

  private writeAll(facts: EntityFact[]): void {
    const data = facts.map((f) => JSON.stringify(f)).join('\n');
    writeFileSync(this.dbPath, data.length > 0 ? data + '\n' : '', 'utf-8');
  }
}
