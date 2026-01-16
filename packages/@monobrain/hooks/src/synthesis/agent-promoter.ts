/**
 * AgentPromoter — Promotes ephemeral agents to permanent registry
 * when they meet quality and usage thresholds (Task 47).
 *
 * Ephemeral agents that consistently perform well are promoted
 * by copying their definition file to the permanent agents directory.
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

    return destPath;
  }
}
