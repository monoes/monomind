import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embedBatch } from '../../src/search/embed-batch.js';
import { HttpEmbedder } from '../../src/search/http-embedder.js';

// Spy on the prototype method instead of mocking the whole module via a
// factory: constructing a class through a vi.mock() factory's returned
// vi.fn() doesn't reliably preserve the factory's `mockImplementation`
// return value under this vitest/tinyspy version — `new MockedClass()`
// silently produces an empty auto-mock instance instead. Spying on the real
// prototype method keeps the real constructor (harmless — it only assigns
// config, no network call) and avoids that pitfall entirely.
let embedBatchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  embedBatchSpy = vi
    .spyOn(HttpEmbedder.prototype, 'embedBatch')
    .mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
});

afterEach(() => {
  embedBatchSpy.mockRestore();
});

describe('embedBatch with remote config', () => {
  it('uses HttpEmbedder when remote config is provided', async () => {
    const result = await embedBatch(['hello', 'world'], {
      remote: { endpoint: 'http://localhost:1234/embed' },
    });
    expect(embedBatchSpy).toHaveBeenCalledWith(['hello', 'world']);
    const instance = embedBatchSpy.mock.contexts[0] as InstanceType<typeof HttpEmbedder> & {
      config: { endpoint: string };
    };
    expect(instance.config.endpoint).toBe('http://localhost:1234/embed');
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it('passes all remote config fields to HttpEmbedder', async () => {
    await embedBatch(['text'], {
      remote: { endpoint: 'http://host/embed', apiKey: 'sk-test', model: 'nomic' },
    });
    const instance = embedBatchSpy.mock.contexts[0] as InstanceType<typeof HttpEmbedder> & {
      config: { endpoint: string; apiKey: string; model: string };
    };
    expect(instance.config).toMatchObject({
      endpoint: 'http://host/embed',
      apiKey: 'sk-test',
      model: 'nomic',
    });
  });
});

describe('embedBatch without remote config', () => {
  it('does not instantiate HttpEmbedder when no remote config', async () => {
    // Local embedder may fail or hang in test env — race against a short timeout
    // so we just verify HttpEmbedder.embedBatch was NOT called regardless of outcome.
    await Promise.race([
      embedBatch(['hello']).catch(() => { /* expected in CI without a real local model */ }),
      new Promise(resolve => setTimeout(resolve, 500)),
    ]);
    expect(embedBatchSpy).not.toHaveBeenCalled();
  }, 2000);
});
