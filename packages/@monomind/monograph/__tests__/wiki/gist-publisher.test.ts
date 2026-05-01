import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishToGist } from '../../src/wiki/gist-publisher.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body };
}

beforeEach(() => mockFetch.mockReset());

const FILES = { 'README.md': '# Hello', 'api.md': '## API' };

describe('publishToGist', () => {
  it('POSTs to create a new gist', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      id: 'abc123', html_url: 'https://gist.github.com/abc123',
      files: { 'README.md': {}, 'api.md': {} },
    }));
    const result = await publishToGist(FILES, { token: 'ghp_test' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/gists',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.gistId).toBe('abc123');
    expect(result.url).toBe('https://gist.github.com/abc123');
    expect(result.filesPublished).toBe(2);
  });

  it('PATCHes an existing gist when gistId is set', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      id: 'existing', html_url: 'https://gist.github.com/existing',
      files: { 'README.md': {} },
    }));
    await publishToGist({ 'README.md': '# Hi' }, { token: 'ghp_test', gistId: 'existing' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/gists/existing',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('includes Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      id: 'x', html_url: 'https://gist.github.com/x', files: {},
    }));
    await publishToGist({}, { token: 'ghp_mytoken' });
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp_mytoken');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}, false, 401));
    await expect(publishToGist(FILES, { token: 'bad' })).rejects.toThrow('401');
  });

  it('sets public flag in request body', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({
      id: 'y', html_url: 'https://gist.github.com/y', files: { 'f.md': {} },
    }));
    await publishToGist({ 'f.md': 'content' }, { token: 'tok', public: true });
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { public: boolean };
    expect(body.public).toBe(true);
  });
});
