/**
 * The embedding model init writes into new configs must be the one the memory
 * bridge actually embeds with — it used to default to all-MiniLM-L6-v2 (384d)
 * while every stored vector came from gte-modernbert-base (768d).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBEDDING_DIMS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_INIT_OPTIONS,
  FULL_INIT_OPTIONS,
  MINIMAL_INIT_OPTIONS,
} from '../init/types.js';
import { embeddingsTools } from '../mcp-tools/embeddings-tools.js';
import { BRIDGE_EMBEDDING_DIMS, BRIDGE_EMBEDDING_MODEL } from '../memory/memory-bridge.js';

describe('init embedding model default', () => {
  it('matches the model and dimensions the memory bridge embeds with', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe(BRIDGE_EMBEDDING_MODEL);
    expect(DEFAULT_EMBEDDING_DIMS).toBe(BRIDGE_EMBEDDING_DIMS);
  });

  it('every init preset defaults to the memory bridge model', () => {
    for (const preset of [DEFAULT_INIT_OPTIONS, MINIMAL_INIT_OPTIONS, FULL_INIT_OPTIONS]) {
      expect(preset.embeddings.model).toBe(BRIDGE_EMBEDDING_MODEL);
    }
  });

  it('embeddings_init defaults to the memory bridge model', () => {
    const tool = embeddingsTools.find((t) => t.name === 'embeddings_init');
    const model = (tool?.inputSchema.properties as Record<string, { default?: unknown }>).model;
    expect(model.default).toBe(BRIDGE_EMBEDDING_MODEL);
  });
});
