import { describe, expect, it } from 'vitest';
import { hasTool, listMCPTools, searchNonCoreTools } from '../mcp-client.js';

/**
 * The mesh tools are deliberately NOT in the default advertised roster: the lean roster of #410
 * has a byte budget (mcp-roster-filter.test.ts) and the mesh has no auto-join hooks yet, so three
 * more tools in every session cost more than they give. They must stay callable by name and
 * discoverable, so this pins both halves of that decision.
 */
const MESH = ['mesh_who', 'mesh_join', 'mesh_leave'];

describe('mesh tools in the default roster', () => {
  it('are not advertised by default', async () => {
    const names = (await listMCPTools()).map((t) => t.name);
    for (const name of MESH) expect(names, name).not.toContain(name);
  });

  it('stay callable by name', async () => {
    for (const name of MESH) expect(await hasTool(name), name).toBe(true);
  });

  it('are found by tool search', async () => {
    const hits = await searchNonCoreTools(
      'which agents are running on this host mesh',
      undefined,
      8,
    );
    expect(hits.some((t) => t.name === 'mesh_who')).toBe(true);
  });
});
