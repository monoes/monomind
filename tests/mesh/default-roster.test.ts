import { describe, expect, it } from 'vitest';
import {
  ensureCategory,
  TOOL_REGISTRY,
} from '../../packages/@monomind/cli/src/mcp-client-registry.js';
import {
  CORE_ADVERTISED_TOOLS,
  ensureCoreLoaded,
} from '../../packages/@monomind/cli/src/mcp-client-roster.js';

const MESH = ['mesh_who', 'mesh_join', 'mesh_leave'];

describe('default MCP roster', () => {
  it('advertises the mesh tools, so a default session can find and join the mesh', () => {
    for (const name of MESH) expect(CORE_ADVERTISED_TOOLS.has(name), name).toBe(true);
  });

  it('only advertises tools that exist once the core categories are loaded', async () => {
    await ensureCoreLoaded();
    const missing = [...CORE_ADVERTISED_TOOLS].filter((n) => !TOOL_REGISTRY.has(n));
    expect(missing).toEqual([]);
  });

  it('keeps the three mesh tools small: the roster is lean on purpose (#410)', async () => {
    await ensureCategory('mesh');
    for (const name of MESH) expect(TOOL_REGISTRY.has(name), `${name} is registered`).toBe(true);
    const bytes = MESH.map((n) => JSON.stringify(TOOL_REGISTRY.get(n))).join('').length;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(4 * 1024);
  });
});
