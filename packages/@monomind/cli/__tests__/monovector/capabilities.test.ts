import { describe, it, expect, beforeEach } from 'vitest';

describe('getCapabilities', () => {
  beforeEach(async () => {
    const { resetCapabilitiesCache } = await import('../../src/monovector/capabilities.js');
    resetCapabilitiesCache();
  });

  it('returns an object with all 4 capability keys', async () => {
    const { getCapabilities } = await import('../../src/monovector/capabilities.js');
    const caps = await getCapabilities();
    expect(caps).toHaveProperty('sona');
    expect(caps).toHaveProperty('router');
    expect(caps).toHaveProperty('attention');
    expect(caps).toHaveProperty('learningWasm');
  });

  it('sona, attention, learningWasm are booleans', async () => {
    const { getCapabilities } = await import('../../src/monovector/capabilities.js');
    const caps = await getCapabilities();
    expect(typeof caps.sona).toBe('boolean');
    expect(typeof caps.attention).toBe('boolean');
    expect(typeof caps.learningWasm).toBe('boolean');
  });

  it('router is native | js | none', async () => {
    const { getCapabilities } = await import('../../src/monovector/capabilities.js');
    const caps = await getCapabilities();
    expect(['native', 'js', 'none']).toContain(caps.router);
  });

  it('second call is fast (cached)', async () => {
    const { getCapabilities } = await import('../../src/monovector/capabilities.js');
    await getCapabilities(); // first call
    const start = Date.now();
    await getCapabilities(); // second call — must be from cache
    expect(Date.now() - start).toBeLessThan(10);
  });

  it('getCachedCapabilities returns null before first call', async () => {
    const { getCachedCapabilities } = await import('../../src/monovector/capabilities.js');
    expect(getCachedCapabilities()).toBeNull();
  });
});
