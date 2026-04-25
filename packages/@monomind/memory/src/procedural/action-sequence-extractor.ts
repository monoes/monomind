/**
 * ActionSequenceExtractor — Groups action records into repeatable skill candidates.
 *
 * Part of Task 45 — Procedural Memory.
 */

import type { ActionRecord, ExtractionConfig, ActionSequenceGroup } from './types.js';
import { DEFAULT_EXTRACTION_CONFIG } from './types.js';

export class ActionSequenceExtractor {
  private config: ExtractionConfig;

  constructor(config: Partial<ExtractionConfig> = {}) {
    this.config = { ...DEFAULT_EXTRACTION_CONFIG, ...config };
  }

  /**
   * Build a fingerprint for a sequence of actions: tool names joined with " -> "
   */
  private fingerprint(records: ActionRecord[]): string {
    return records.map((r) => r.toolName).join(' -> ');
  }

  /**
   * Extract action sequence groups from a flat list of records.
   *
   * 1. Group records by agentSlug
   * 2. Within each agent, group by runId to get per-run sequences
   * 3. Fingerprint each run sequence (toolName chain)
   * 4. Group runs with identical fingerprints
   * 5. Filter by minSuccessCount, minAvgQualityScore, maxSequenceLength
   */
  extract(allRecords: ActionRecord[]): ActionSequenceGroup[] {
    // Group by agentSlug
    const byAgent = new Map<string, ActionRecord[]>();
    for (const r of allRecords) {
      const arr = byAgent.get(r.agentSlug) ?? [];
      arr.push(r);
      byAgent.set(r.agentSlug, arr);
    }

    const results: ActionSequenceGroup[] = [];

    for (const [agentSlug, records] of byAgent) {
      // Group by runId
      const byRun = new Map<string, ActionRecord[]>();
      for (const r of records) {
        const arr = byRun.get(r.runId) ?? [];
        arr.push(r);
        byRun.set(r.runId, arr);
      }

      // Sort each run's records by timestamp, compute fingerprint
      const fingerprintGroups = new Map<string, { sequences: ActionRecord[][]; runIds: string[] }>();
      for (const [runId, runRecords] of byRun) {
        const sorted = runRecords.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        // Skip sequences that exceed max length
        if (sorted.length > this.config.maxSequenceLength) continue;

        const fp = this.fingerprint(sorted);
        const group = fingerprintGroups.get(fp) ?? { sequences: [], runIds: [] };
        group.sequences.push(sorted);
        group.runIds.push(runId);
        fingerprintGroups.set(fp, group);
      }

      // Filter and build result groups
      for (const [fp, group] of fingerprintGroups) {
        // Only successful runs count
        const successfulSequences = group.sequences.filter((seq) =>
          seq.every((r) => r.outcome === 'success'),
        );
        const successCount = successfulSequences.length;

        if (successCount < this.config.minSuccessCount) continue;

        // Compute average quality score across all records in successful sequences
        const allQualityScores: number[] = [];
        for (const seq of successfulSequences) {
          for (const r of seq) {
            if (r.qualityScore !== undefined) {
              allQualityScores.push(r.qualityScore);
            }
          }
        }

        const avgQualityScore =
          allQualityScores.length > 0
            ? allQualityScores.reduce((a, b) => a + b, 0) / allQualityScores.length
            : 0;

        if (avgQualityScore < this.config.minAvgQualityScore) continue;

        results.push({
          agentSlug,
          fingerprint: fp,
          sequences: successfulSequences,
          successCount,
          avgQualityScore,
          runIds: group.runIds.filter((_, i) =>
            group.sequences[i].every((r) => r.outcome === 'success'),
          ),
        });
      }
    }

    return results;
  }
}
