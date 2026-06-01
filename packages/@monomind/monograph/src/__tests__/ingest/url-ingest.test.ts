import { describe, it, expect, vi } from 'vitest';
import { ingestUrl, classifyUrlType } from '../../ingest/url-ingest.js';

describe('classifyUrlType', () => {
  it('detects arxiv', () => {
    expect(classifyUrlType('https://arxiv.org/abs/2401.00001')).toBe('paper');
  });
  it('detects github', () => {
    expect(classifyUrlType('https://github.com/user/repo')).toBe('github');
  });
  it('detects youtube', () => {
    expect(classifyUrlType('https://www.youtube.com/watch?v=abc')).toBe('video');
  });
  it('defaults to webpage', () => {
    expect(classifyUrlType('https://example.com/article')).toBe('webpage');
  });
});

describe('ingestUrl', () => {
  it('returns IngestResult with id, type, and url', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><title>Test Page</title><body>Hello world content here</body></html>',
      headers: { get: (_h: string) => 'text/html' },
    });
    const result = await ingestUrl('https://example.com/page', { fetch: mockFetch as any });
    expect(result.url).toBe('https://example.com/page');
    expect(result.type).toBe('webpage');
    expect(typeof result.id).toBe('string');
    expect(result.title).toBeTruthy();
  });

  it('blocks private URLs', async () => {
    await expect(ingestUrl('http://localhost/admin', {})).rejects.toThrow();
  });

  it('blocks oversized responses', async () => {
    const bigBody = 'x'.repeat(11 * 1024 * 1024);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => bigBody,
      headers: { get: (h: string) => h === 'content-length' ? String(bigBody.length) : 'text/html' },
    });
    await expect(
      ingestUrl('https://example.com/big', { fetch: mockFetch as any, maxBytes: 10 * 1024 * 1024 })
    ).rejects.toThrow(/too large/i);
  });
});
