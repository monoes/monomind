import { describe, it, expect } from 'vitest';
import { listMCPTools, searchNonCoreTools } from '../mcp-client.js';

/**
 * The default `tools/list` advertises only a core roster (~80 tools) to keep
 * the per-call schema payload small. Non-core tools stay callable by name and
 * discoverable via monomind_tool_search. MONOMIND_MCP_FULL=1 restores the full
 * roster, but that env var is read at module load — these tests run in the
 * default (core) mode.
 */
describe('MCP core-roster filter', () => {
  it('advertises the core set and the discovery tool, not the whole registry', async () => {
    const tools = await listMCPTools();
    const names = new Set(tools.map((t) => t.name));

    // Core capabilities are advertised.
    expect(names.has('memory_kg_search')).toBe(true);
    expect(names.has('monograph_query')).toBe(true);
    expect(names.has('monomind_tool_search')).toBe(true);

    // Non-core capabilities are NOT advertised by default.
    expect(names.has('browser_open')).toBe(false);
    expect(names.has('github_pr_manage')).toBe(false);
    expect(names.has('swarm_init')).toBe(false);

    // The advertised roster is meaningfully smaller than the full registry.
    expect(tools.length).toBeLessThan(150);
  });

  it('hides most of the hooks family but keeps the routing core', async () => {
    const tools = await listMCPTools();
    const names = new Set(tools.map((t) => t.name));
    expect(names.has('hooks_route')).toBe(true);
    expect(names.has('hooks_pre-task')).toBe(true);
    // Trajectory/intelligence/worker hooks are discovery-only.
    expect(names.has('hooks_trajectory-start')).toBe(false);
  });

  it('makes non-core tools discoverable via searchNonCoreTools', async () => {
    const browserHits = await searchNonCoreTools('browser open page navigate', undefined, 5);
    expect(browserHits.length).toBeGreaterThan(0);
    expect(browserHits.some((t) => t.name === 'browser_open')).toBe(true);
    // Every returned tool carries a schema so it can be called directly.
    for (const t of browserHits) {
      expect(t.inputSchema).toBeDefined();
      expect(t.category).toBe('browser');
    }
  });
});
