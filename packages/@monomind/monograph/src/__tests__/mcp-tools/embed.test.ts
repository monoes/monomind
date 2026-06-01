import { describe, it, expect } from 'vitest';

describe('embed tool exports', () => {
  it('runEmbed is exported from mcp-tools index', async () => {
    const mod = await import('../../mcp-tools/index.js');
    expect(typeof (mod as any).runEmbed).toBe('function');
  });

  it('runEmbed is directly importable from embed.js', async () => {
    const { runEmbed } = await import('../../mcp-tools/embed.js');
    expect(typeof runEmbed).toBe('function');
  });
});
