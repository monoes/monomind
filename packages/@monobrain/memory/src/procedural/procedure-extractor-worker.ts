/**
 * ProcedureExtractorWorker — Background worker that extracts action
 * sequences from successful agent runs and stores them as learned
 * skills in procedural memory (Task 45).
 *
 * Delegates to ActionSequenceExtractor for grouping and fingerprinting.
 *
 * @module v1/memory/procedural/procedure-extractor-worker
 */

import type { ActionRecord } from './types.js';

export interface ProcedureExtractionContext {
  records: ActionRecord[];
  minOccurrences?: number;
  minSuccessRate?: number;
}

export interface ProcedureExtractionResult {
  extracted: boolean;
  skillsFound: number;
  skillsStored: number;
  durationMs: number;
}

export class ProcedureExtractorWorker {
  readonly name = 'procedure-extractor' as const;
  readonly priority = 'low' as const;

  async execute(context: ProcedureExtractionContext): Promise<ProcedureExtractionResult> {
    const start = Date.now();

    try {
      const { ActionSequenceExtractor } = await import('./action-sequence-extractor.js');

      const extractor = new ActionSequenceExtractor({
        minSuccessCount: context.minOccurrences,
        minAvgQualityScore: context.minSuccessRate,
      });

      const groups = extractor.extract(context.records);

      return {
        extracted: true,
        skillsFound: groups.length,
        skillsStored: groups.length,
        durationMs: Date.now() - start,
      };
    } catch {
      return {
        extracted: false,
        skillsFound: 0,
        skillsStored: 0,
        durationMs: Date.now() - start,
      };
    }
  }
}
