import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeFetch, validateUrl, isPrivateUrl } from '../../security/safe-fetch.js';

describe('isPrivateUrl', () => {
  it('returns true for localhost', () => {
    expect(isPrivateUrl('http://localhost/path')).toBe(true);
  });
  it('returns true for 127.x address', () => {
    expect(isPrivateUrl('http://127.0.0.1/')).toBe(true);
  });
  it('returns true for 10.x private', () => {
    expect(isPrivateUrl('http://10.0.0.1/')).toBe(true);
  });
  it('returns true for 192.168.x.x', () => {
    expect(isPrivateUrl('http://192.168.1.1/')).toBe(true);
  });
  it('returns false for public IP', () => {
    expect(isPrivateUrl('https://8.8.8.8/')).toBe(false);
  });
  it('returns false for public hostname', () => {
    expect(isPrivateUrl('https://example.com/')).toBe(false);
  });
  it('returns true for cloud metadata address', () => {
    expect(isPrivateUrl('http://169.254.169.254/latest/meta-data')).toBe(true);
  });
});

describe('validateUrl', () => {
  it('throws on file: scheme', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow(/Unsupported scheme/);
  });
  it('throws on ftp: scheme', () => {
    expect(() => validateUrl('ftp://example.com/')).toThrow(/Unsupported scheme/);
  });
  it('throws on invalid URL', () => {
    expect(() => validateUrl('not-a-url')).toThrow(/Invalid URL/);
  });
  it('throws on private IP', () => {
    expect(() => validateUrl('http://10.0.0.1/')).toThrow(/private\/reserved/);
  });
  it('passes for valid public https URL', () => {
    expect(() => validateUrl('https://example.com/')).not.toThrow();
  });
});

describe('safeFetch — streaming size enforcement', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects when streamed bytes exceed maxBytes before body is complete', async () => {
    // Simulate a response whose body stream sends more than maxBytes
    const encoder = new TextEncoder();
    const chunk1 = encoder.encode('A'.repeat(50));
    const chunk2 = encoder.encode('B'.repeat(50));

    const mockBody = {
      getReader() {
        let call = 0;
        return {
          read() {
            call++;
            if (call === 1) return Promise.resolve({ value: chunk1, done: false });
            if (call === 2) return Promise.resolve({ value: chunk2, done: false });
            return Promise.resolve({ value: undefined, done: true });
          },
          releaseLock() {},
        };
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: mockBody,
      text: () => Promise.resolve('A'.repeat(100)),
    }));

    // maxBytes = 60 — stream sends 100 bytes total, should abort at 60
    await expect(
      safeFetch('https://example.com/', { maxBytes: 60 })
    ).rejects.toThrow(/exceeds/);
  });

  it('succeeds when response body is within maxBytes', async () => {
    const encoder = new TextEncoder();
    const chunk = encoder.encode('hello world');

    const mockBody = {
      getReader() {
        let done = false;
        return {
          read() {
            if (!done) {
              done = true;
              return Promise.resolve({ value: chunk, done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
          releaseLock() {},
        };
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: mockBody,
    }));

    const result = await safeFetch('https://example.com/', { maxBytes: 1024 });
    expect(result).toBe('hello world');
  });

  it('throws when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
    }));

    await expect(safeFetch('https://example.com/')).rejects.toThrow(/HTTP 404/);
  });
});
