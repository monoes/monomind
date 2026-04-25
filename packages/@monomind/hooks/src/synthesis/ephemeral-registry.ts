/**
 * Ephemeral Agent Registry — Task 47
 *
 * Singleton registry tracking synthesized agents with
 * TTL, usage counts, quality scores, and promotion state.
 */

import type { EphemeralAgentRecord } from './types.js';
import { AgentPromoter } from './agent-promoter.js';

export class EphemeralRegistry {
  private static instance: EphemeralRegistry | undefined;
  private records = new Map<string, EphemeralAgentRecord>();

  private constructor() {}

  /** Get the singleton instance */
  static getInstance(): EphemeralRegistry {
    if (!EphemeralRegistry.instance) {
      EphemeralRegistry.instance = new EphemeralRegistry();
    }
    return EphemeralRegistry.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    EphemeralRegistry.instance = undefined;
  }

  /** Register an ephemeral agent record */
  register(record: EphemeralAgentRecord): void {
    this.records.set(record.slug, { ...record });
  }

  /** Check if a slug is registered */
  isRegistered(slug: string): boolean {
    return this.records.has(slug);
  }

  /** Get a single record by slug */
  get(slug: string): EphemeralAgentRecord | undefined {
    const r = this.records.get(slug);
    return r ? { ...r } : undefined;
  }

  /** Get all records (defensive copy) */
  getAll(): Map<string, EphemeralAgentRecord> {
    const copy = new Map<string, EphemeralAgentRecord>();
    for (const [k, v] of this.records) {
      copy.set(k, { ...v });
    }
    return copy;
  }

  /**
   * Increment usage count and update rolling quality average.
   * If qualityScore is provided, it is folded into the running average.
   */
  incrementUsage(slug: string, qualityScore?: number): void {
    const record = this.records.get(slug);
    if (!record) return;

    record.usageCount += 1;

    if (qualityScore !== undefined) {
      const prev = record.avgQualityScore;
      const n = record.usageCount;
      // Rolling average: new_avg = prev + (score - prev) / n
      record.avgQualityScore = prev + (qualityScore - prev) / n;
    }
  }

  /** Mark an agent as promoted (prevents TTL deletion) */
  markPromoted(slug: string): void {
    const record = this.records.get(slug);
    if (record) {
      record.promoted = true;
    }
  }

  /** List all expired, non-promoted records */
  listExpired(): EphemeralAgentRecord[] {
    const now = new Date();
    const expired: EphemeralAgentRecord[] = [];
    for (const record of this.records.values()) {
      if (!record.promoted && record.expiresAt <= now) {
        expired.push({ ...record });
      }
    }
    return expired;
  }

  /** Remove a record by slug (used by cleanup) */
  remove(slug: string): boolean {
    return this.records.delete(slug);
  }

  /** Current count of registered agents */
  get size(): number {
    return this.records.size;
  }

  /**
   * Return all records that are eligible for promotion to the permanent registry
   * and the DGM MAP-Elites archive (source: arXiv:2505.22954).
   *
   * This is the primary call site for AgentPromoter.isEligible().
   */
  getPromotionCandidates(): EphemeralAgentRecord[] {
    const candidates: EphemeralAgentRecord[] = [];
    for (const record of this.records.values()) {
      if (AgentPromoter.isEligible(record)) {
        candidates.push({ ...record });
      }
    }
    return candidates;
  }
}
