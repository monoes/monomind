/**
 * AgentPromoter — Promotes ephemeral agents to permanent registry
 * when they meet quality and usage thresholds (Task 47).
 *
 * Ephemeral agents that consistently perform well are promoted
 * by copying their definition file to the permanent agents directory.
 * Promoted agents are also entered into the DGM MAP-Elites archive.
 *
 * @module v1/hooks/synthesis/agent-promoter
 */

import type { EphemeralAgentRecord } from './types.js';

export class AgentPromoter {
  /** Minimum average quality score to be eligible for promotion */
  static readonly PROMOTION_THRESHOLD = 0.8;

  /** Minimum number of uses before promotion is considered */
  static readonly MIN_USAGE_COUNT = 5;

  /**
   * Check whether an ephemeral agent record is eligible for promotion.
   *
   * Requirements:
   * - Not already promoted
   * - Used at least MIN_USAGE_COUNT times
   * - Average quality score at or above PROMOTION_THRESHOLD
   */
  static isEligible(record: EphemeralAgentRecord): boolean {
    return (
      !record.promoted &&
      record.usageCount >= AgentPromoter.MIN_USAGE_COUNT &&
      record.avgQualityScore >= AgentPromoter.PROMOTION_THRESHOLD
    );
  }

  /**
   * Promote an ephemeral agent by copying its definition file
   * to the permanent agent directory under a "promoted" subdirectory.
   * Also registers the agent in the global DGM MAP-Elites archive.
   *
   * @returns The destination file path of the promoted agent definition.
   */
  static async promote(
    record: EphemeralAgentRecord,
    targetDir: string,
  ): Promise<string> {
    const { copyFile, mkdir } = await import('fs/promises');
    const { join, basename } = await import('path');

    const category = 'promoted';
    const destDir = join(targetDir, category);
    await mkdir(destDir, { recursive: true });

    const destPath = join(destDir, basename(record.filePath));
    await copyFile(record.filePath, destPath);

    // Register in the DGM MAP-Elites archive (source: arXiv:2505.22954)
    // EphemeralAgentRecord has no capabilities field; derive niche from slug prefix
    const capability = record.slug.split('-')[0] ?? 'general';
    DGMArchive.getInstance().add({
      slug: record.slug,
      qualityScore: record.avgQualityScore,
      usageCount: record.usageCount,
      capability,
      promotedAt: new Date(),
      filePath: destPath,
    });

    return destPath;
  }
}

// ============================================================
// DGM MAP-Elites Archive
// Darwin Gödel Machine — MAP-Elites behavioral archive of agent variants
// Source: https://arxiv.org/abs/2505.22954
// ============================================================

export interface DGMArchiveEntry {
  /** Agent slug identifier */
  slug: string;
  /** Average quality score at promotion time */
  qualityScore: number;
  /** Usage count at promotion time */
  usageCount: number;
  /** Primary capability category (defines one niche dimension) */
  capability: string;
  /** When the agent was promoted */
  promotedAt: Date;
  /** File path of the agent definition */
  filePath: string;
}

/** A niche cell key: `capability:qualityBucket` (e.g. "coder:0.9") */
type NicheKey = string;

/**
 * DGMArchive — MAP-Elites behavioral archive of promoted agent variants.
 *
 * The archive partitions agents into niches defined by:
 *   - capability category (e.g. "coder", "security", "general")
 *   - quality score bucket (rounded to nearest 0.1)
 *
 * Each niche retains only the single best agent (highest quality score).
 * This ensures the archive always reflects Pareto-optimal coverage of the
 * capability–quality behavior space, analogous to the MAP-Elites algorithm.
 *
 * Source: https://arxiv.org/abs/2505.22954
 */
export class DGMArchive {
  private static instance: DGMArchive | undefined;

  /** niche key → best entry for that niche */
  private readonly cells = new Map<NicheKey, DGMArchiveEntry>();

  private constructor() {}

  static getInstance(): DGMArchive {
    if (!DGMArchive.instance) DGMArchive.instance = new DGMArchive();
    return DGMArchive.instance;
  }

  /** Reset singleton (for testing) */
  static resetInstance(): void {
    DGMArchive.instance = undefined;
  }

  /** Add or update an entry in the archive. Replaces the cell occupant only if
   *  the new entry has a higher quality score. */
  add(entry: DGMArchiveEntry): boolean {
    const key = this.nicheKey(entry);
    const existing = this.cells.get(key);
    if (!existing || entry.qualityScore > existing.qualityScore) {
      this.cells.set(key, entry);
      return true;
    }
    return false;
  }

  /** Retrieve the best agent for a given capability and quality bucket. */
  get(capability: string, qualityBucket: number): DGMArchiveEntry | undefined {
    return this.cells.get(`${capability}:${qualityBucket.toFixed(1)}`);
  }

  /** List all archive cells (one best entry per niche). */
  listAll(): DGMArchiveEntry[] {
    return [...this.cells.values()];
  }

  /** Return the overall best agent across all niches. */
  best(): DGMArchiveEntry | undefined {
    let top: DGMArchiveEntry | undefined;
    for (const entry of this.cells.values()) {
      if (!top || entry.qualityScore > top.qualityScore) top = entry;
    }
    return top;
  }

  /** Number of occupied niche cells. */
  get size(): number { return this.cells.size; }

  // ------------------------------------------------------------------
  private nicheKey(entry: DGMArchiveEntry): NicheKey {
    const bucket = Math.round(entry.qualityScore * 10) / 10;
    return `${entry.capability}:${bucket.toFixed(1)}`;
  }
}
