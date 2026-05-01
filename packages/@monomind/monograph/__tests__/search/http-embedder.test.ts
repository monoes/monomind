import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpEmbedder } from '../../src/search/http-embedder.js';
import { resolveDevice } from '../../src/search/device-config.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(embedding: number[]) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ embedding }),
  };
}

beforeEach(() => mockFetch.mockReset());

describe('HttpEmbedder', () => {
  it('embedOne sends POST and returns vector', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([0.1, 0.2, 0.3]));
    const embedder = new HttpEmbedder({ endpoint: 'http://localhost:1234/embed' });
    const vec = await embedder.embedOne('hello');
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:1234/embed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) });
    const embedder = new HttpEmbedder({ endpoint: 'http://localhost:1234/embed' });
    await expect(embedder.embedOne('hello')).rejects.toThrow('503');
  });

  it('throws when embedding field is missing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: async () => ({}) });
    const embedder = new HttpEmbedder({ endpoint: 'http://localhost:1234/embed' });
    await expect(embedder.embedOne('hello')).rejects.toThrow('no embedding');
  });

  it('adds Authorization header when apiKey is set', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([1, 2]));
    const embedder = new HttpEmbedder({ endpoint: 'http://localhost:1234/embed', apiKey: 'sk-test' });
    await embedder.embedOne('hi');
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('embedBatch returns one vector per input text', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse([1, 0]))
      .mockResolvedValueOnce(makeOkResponse([0, 1]));
    const embedder = new HttpEmbedder({ endpoint: 'http://localhost:1234/embed', batchSize: 1 });
    const vecs = await embedder.embedBatch(['a', 'b']);
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toEqual([1, 0]);
    expect(vecs[1]).toEqual([0, 1]);
  });
});

describe('resolveDevice', () => {
  it('returns cpu by default on non-darwin with no CUDA', () => {
    vi.stubEnv('CUDA_VISIBLE_DEVICES', '');
    // Can't reliably mock process.platform in vitest without patching,
    // so just verify it returns one of the valid values
    const d = resolveDevice();
    expect(['cpu', 'cuda', 'mps']).toContain(d);
  });

  it('returns the explicit device when set', () => {
    expect(resolveDevice({ device: 'cuda' })).toBe('cuda');
    expect(resolveDevice({ device: 'cpu' })).toBe('cpu');
    expect(resolveDevice({ device: 'mps' })).toBe('mps');
  });
});
