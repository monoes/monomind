/**
 * EntityExtractorWorker — Background worker that extracts entity facts
 * from agent run transcripts (Task 10).
 *
 * Uses an injected extractor function so callers can swap in an LLM-backed
 * implementation while tests supply a simple mock.
 *
 * @module v1/hooks/workers/entity-extractor
 */

import type { EntityFact } from '../../../memory/src/tiers/entity.js';

export interface EntityExtractorConfig {
  entityMemory: { store(fact: EntityFact): void };
  /** Injected extractor — in production this calls an LLM; in tests it's a mock */
  extractFacts: (transcript: string, runId: string) => Promise<EntityFact[]>;
}

export class EntityExtractorWorker {
  constructor(private config: EntityExtractorConfig) {}

  /** Process a completed task's transcript and extract entity facts */
  async processTranscript(transcript: string, runId: string): Promise<number> {
    if (!transcript || transcript.length < 50) return 0;

    try {
      const facts = await this.config.extractFacts(transcript, runId);
      for (const fact of facts) {
        this.config.entityMemory.store(fact);
      }
      return facts.length;
    } catch {
      // Never block task completion due to extraction failure
      return 0;
    }
  }
}

/** Default extraction prompt builder (for use with LLM callers) */
export function buildExtractionPrompt(transcript: string): string {
  return `Extract named entity facts from the following agent run transcript.
Return a JSON array of objects with keys: entity, factType, value, confidence (0.0-1.0).

Examples of entity types: file paths, API endpoints, library names, CVE IDs, repo names.
Examples of fact types: "uses_library", "has_vulnerability", "owner", "version", "status".

Transcript:
${transcript.slice(0, 6000)}

Respond with ONLY a JSON array, no prose.`;
}

/** Parse raw LLM output into EntityFact array */
export function parseEntityFacts(raw: string, runId: string): EntityFact[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (f: Record<string, unknown>) =>
          typeof f.entity === 'string' &&
          typeof f.factType === 'string' &&
          typeof f.value === 'string',
      )
      .map(
        (f: Record<string, unknown>): EntityFact => ({
          entity: f.entity as string,
          factType: f.factType as string,
          value: f.value as string,
          confidence:
            typeof f.confidence === 'number'
              ? (f.confidence as number)
              : 0.8,
          sourceRunId: runId,
          createdAt: Date.now(),
        }),
      );
  } catch {
    return [];
  }
}
