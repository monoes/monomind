import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock HttpEmbedder before importing embedBatch.
// Note: vitest 4.x requires a regular function (not an arrow function) when
// the mock will be called via `new`, because arrow functions are not constructable.
vi.mock('../../src/search/http-embedder.js', () => ({
  HttpEmbedder: vi.fn().mockImplementation(function () {
    return {
      embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
    };
  }),
}));

import { embedBatch } from '../../src/search/embed-batch.js';
import { HttpEmbedder } from '../../src/search/http-embedder.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('embedBatch with remote config', () => {
  it('uses HttpEmbedder when remote config is provided', async () => {
    const result = await embedBatch(['hello', 'world'], {
      remote: { endpoint: 'http://localhost:1234/embed' },
    });
    expect(HttpEmbedder).toHaveBeenCalledWith({ endpoint: 'http://localhost:1234/embed' });
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('passes all remote config fields to HttpEmbedder', async () => {
    await embedBatch(['text'], {
      remote: { endpoint: 'http://host/embed', apiKey: 'sk-test', model: 'nomic' },
    });
    expect(HttpEmbedder).toHaveBeenCalledWith({
      endpoint: 'http://host/embed',
      apiKey: 'sk-test',
      model: 'nomic',
    });
  });
});

describe('embedBatch without remote config', () => {
  it('does not instantiate HttpEmbedder when no remote config', async () => {
    // Local embedder may fail in test env — that's fine, we just check HttpEmbedder wasn't used
    try {
      await embedBatch(['hello']);
    } catch {
      // expected in test env without a real local model
    }
    expect(HttpEmbedder).not.toHaveBeenCalled();
  });
});
