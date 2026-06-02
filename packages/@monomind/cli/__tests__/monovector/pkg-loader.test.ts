import { describe, it, expect, beforeEach } from 'vitest';

describe('pkg-loader', () => {
  beforeEach(async () => {
    // Reset module cache between tests
    const { clearCache } = await import('../../src/monovector/pkg-loader.js');
    clearCache();
  });

  it('returns null when package does not exist', async () => {
    const { tryLoad } = await import('../../src/monovector/pkg-loader.js');
    const result = await tryLoad('@nonexistent/pkg-that-does-not-exist-xyz');
    expect(result).toBeNull();
  });

  it('caches null after first failed attempt', async () => {
    const { tryLoad, getCached } = await import('../../src/monovector/pkg-loader.js');
    await tryLoad('@nonexistent/pkg-xyz-abc-123');
    const cached = getCached('@nonexistent/pkg-xyz-abc-123');
    expect(cached).toBeNull();
  });

  it('does not re-import if already cached as null', async () => {
    const { tryLoad } = await import('../../src/monovector/pkg-loader.js');
    const r1 = await tryLoad('@nonexistent/repeat-xyz-456');
    const r2 = await tryLoad('@nonexistent/repeat-xyz-456');
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('getCached returns undefined before any load attempt', async () => {
    const { getCached } = await import('../../src/monovector/pkg-loader.js');
    const result = getCached('@never-tried/this-pkg');
    expect(result).toBeUndefined();
  });
});
