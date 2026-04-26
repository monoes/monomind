import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { EntityFact } from '../../packages/@monomind/memory/src/tiers/entity.js';
import {
  EntityExtractorWorker,
  buildExtractionPrompt,
  parseEntityFacts,
} from '../../packages/@monomind/hooks/src/workers/entity-extractor.js';

function makeFact(overrides: Partial<EntityFact> = {}): EntityFact {
  return {
    entity: 'express',
    factType: 'uses_library',
    value: 'HTTP framework',
    confidence: 0.95,
    sourceRunId: 'run-1',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('EntityExtractorWorker', () => {
  let storeMock: ReturnType<typeof vi.fn>;
  let extractMock: ReturnType<typeof vi.fn>;
  let worker: EntityExtractorWorker;

  beforeEach(() => {
    storeMock = vi.fn();
    extractMock = vi.fn();
    worker = new EntityExtractorWorker({
      entityMemory: { store: storeMock },
      extractFacts: extractMock,
    });
  });

  it('extracts facts from transcript via injected extractor', async () => {
    const facts = [makeFact()];
    extractMock.mockResolvedValue(facts);
    const transcript = 'A'.repeat(100);

    await worker.processTranscript(transcript, 'run-1');

    expect(extractMock).toHaveBeenCalledWith(transcript, 'run-1');
  });

  it('stores extracted facts in entity memory', async () => {
    const facts = [makeFact(), makeFact({ entity: 'lodash' })];
    extractMock.mockResolvedValue(facts);

    await worker.processTranscript('A'.repeat(100), 'run-1');

    expect(storeMock).toHaveBeenCalledTimes(2);
    expect(storeMock).toHaveBeenCalledWith(facts[0]);
    expect(storeMock).toHaveBeenCalledWith(facts[1]);
  });

  it('ignores short transcripts (< 50 chars) and returns 0', async () => {
    const result = await worker.processTranscript('short', 'run-1');

    expect(result).toBe(0);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('does not throw on extractor failure, returns 0', async () => {
    extractMock.mockRejectedValue(new Error('LLM unavailable'));

    const result = await worker.processTranscript('A'.repeat(100), 'run-1');

    expect(result).toBe(0);
  });

  it('returns correct count of extracted facts', async () => {
    const facts = [makeFact(), makeFact({ entity: 'react' }), makeFact({ entity: 'vue' })];
    extractMock.mockResolvedValue(facts);

    const result = await worker.processTranscript('A'.repeat(100), 'run-1');

    expect(result).toBe(3);
  });
});

describe('parseEntityFacts', () => {
  it('parses valid JSON array', () => {
    const raw = JSON.stringify([
      { entity: 'express', factType: 'uses_library', value: 'HTTP framework', confidence: 0.9 },
    ]);

    const result = parseEntityFacts(raw, 'run-1');

    expect(result).toHaveLength(1);
    expect(result[0].entity).toBe('express');
    expect(result[0].factType).toBe('uses_library');
    expect(result[0].value).toBe('HTTP framework');
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].sourceRunId).toBe('run-1');
  });

  it('returns empty array for malformed JSON', () => {
    const result = parseEntityFacts('not json at all', 'run-1');
    expect(result).toEqual([]);
  });

  it('filters out entries missing required fields', () => {
    const raw = JSON.stringify([
      { entity: 'express', factType: 'uses_library', value: 'ok' },
      { entity: 'lodash' }, // missing factType and value
      { factType: 'uses_library', value: 'missing entity' }, // missing entity
    ]);

    const result = parseEntityFacts(raw, 'run-1');

    expect(result).toHaveLength(1);
    expect(result[0].entity).toBe('express');
  });

  it('uses default confidence (0.8) when not provided', () => {
    const raw = JSON.stringify([
      { entity: 'express', factType: 'uses_library', value: 'HTTP framework' },
    ]);

    const result = parseEntityFacts(raw, 'run-1');

    expect(result[0].confidence).toBe(0.8);
  });
});

describe('buildExtractionPrompt', () => {
  it('truncates long transcripts to 6000 chars', () => {
    const longTranscript = 'X'.repeat(10000);
    const prompt = buildExtractionPrompt(longTranscript);

    // The transcript portion should be at most 6000 chars
    const transcriptInPrompt = prompt.split('Transcript:\n')[1].split('\n\nRespond')[0];
    expect(transcriptInPrompt.length).toBe(6000);
  });
});
