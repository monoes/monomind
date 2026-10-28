import { afterAll, describe, expect, it, vi } from 'vitest';

/** MONOMIND_MCP_PROFILE is read at module load, so set it before importing the client. */
describe('MCP roster with MONOMIND_MCP_PROFILE=lean', () => {
  const prev = process.env.MONOMIND_MCP_PROFILE;
  afterAll(() => {
    if (prev === undefined) delete process.env.MONOMIND_MCP_PROFILE;
    else process.env.MONOMIND_MCP_PROFILE = prev;
  });

  it('advertises only the lean set and keeps the rest callable', async () => {
    process.env.MONOMIND_MCP_PROFILE = 'lean';
    vi.resetModules();
    const { listMCPTools, hasTool } = await import('../mcp-client.js');
    const { LEAN_ADVERTISED_TOOLS } = await import('../mcp-client-roster.js');
    const names = new Set((await listMCPTools()).map((t) => t.name));
    expect([...names].sort()).toEqual([...LEAN_ADVERTISED_TOOLS].sort());
    expect(await hasTool('memory_kg_search')).toBe(true);
  });
});
