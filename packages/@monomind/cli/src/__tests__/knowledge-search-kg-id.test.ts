/**
 * mcp__monomind__knowledge_search's KG-triplet fusion had the same bug as
 * `doc search` (see doc-search-kg-id.test.ts): building
 * `{ id: <synthetic key>, kind: 'triplet', ...t }` spreads the raw triplet
 * AFTER the explicit `id`, so the triplet's own bridge-entry id silently won
 * over the synthetic `kg:<i>:<source>|<relation>|<target>` key (TS2783).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MCPToolResult } from '../mcp-tools/types.js';

vi.mock('../memory/memory-kg.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../memory/memory-kg.js')>();
  return {
    ...actual,
    kgSearch: vi.fn(async () => ({
      success: true,
      context: 'stub',
      triplets: [
        {
          source: 'A',
          relation: 'relates_to',
          target: 'B',
          fact: 'A relates_to B',
          score: 0.9,
          id: 'entry_raw_bridge_id_67890',
          key: 'e:deadbeef',
        },
      ],
      seeds: [],
    })),
  };
});
vi.mock('../knowledge/document-pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../knowledge/document-pipeline.js')>();
  return { ...actual, searchKnowledge: vi.fn(async () => []) };
});

const { knowledgeTools } = await import('../mcp-tools/knowledge-tools.js');

afterAll(() => {
  vi.restoreAllMocks();
});

describe('knowledge_search - KG triplet fusion preserves the synthetic id, not the raw triplet id', () => {
  it('uses the synthetic "kg:<index>:<source>|<relation>|<target>" id, not the triplet\'s own bridge-entry id', async () => {
    const tool = knowledgeTools.find((t) => t.name === 'knowledge_search')!;
    const result = (await tool.handler({
      query: 'A relates_to B',
      surfaces: ['kg'],
    })) as MCPToolResult;
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.success).toBe(true);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].kind).toBe('triplet');
    expect(parsed.results[0].id).toBe('kg:0:A|relates_to|B');
    expect(parsed.results[0].id).not.toBe('entry_raw_bridge_id_67890');
  });
});
