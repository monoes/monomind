import { describe, it, expect } from 'vitest';

describe('group-sync tool exports', () => {
  it('runGroupSync is exported from mcp-tools index', async () => {
    const mod = await import('../../mcp-tools/index.js');
    expect(typeof (mod as any).runGroupSync).toBe('function');
  });
});
