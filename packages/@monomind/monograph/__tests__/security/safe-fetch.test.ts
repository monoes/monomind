import { describe, it, expect } from 'vitest';
import { isPrivateUrl, validateUrl } from '../../src/security/safe-fetch.js';

describe('isPrivateUrl', () => {
  it('blocks localhost', () => {
    expect(isPrivateUrl('http://localhost/data')).toBe(true);
    expect(isPrivateUrl('http://127.0.0.1:8080/api')).toBe(true);
    expect(isPrivateUrl('http://[::1]/api')).toBe(true);
  });

  it('blocks RFC-1918 private ranges', () => {
    expect(isPrivateUrl('http://192.168.1.1/data')).toBe(true);
    expect(isPrivateUrl('http://10.0.0.1/data')).toBe(true);
    expect(isPrivateUrl('http://172.16.0.1/data')).toBe(true);
  });

  it('blocks cloud metadata endpoints', () => {
    expect(isPrivateUrl('http://169.254.169.254/latest/meta-data')).toBe(true);
    expect(isPrivateUrl('http://metadata.google.internal/')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isPrivateUrl('https://api.github.com/repos')).toBe(false);
    expect(isPrivateUrl('https://raw.githubusercontent.com/file.ts')).toBe(false);
  });
});

describe('validateUrl', () => {
  it('rejects non-http schemes', () => {
    expect(() => validateUrl('file:///etc/passwd')).toThrow('Unsupported scheme');
    expect(() => validateUrl('ftp://example.com')).toThrow('Unsupported scheme');
  });

  it('rejects private URLs', () => {
    expect(() => validateUrl('http://192.168.1.1/admin')).toThrow('private');
  });

  it('accepts valid https URLs', () => {
    expect(() => validateUrl('https://example.com/api')).not.toThrow();
  });
});
