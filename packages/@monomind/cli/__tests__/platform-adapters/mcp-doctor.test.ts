import { describe, expect, it } from 'vitest';
import { getAllMCPTools, listMCPTools } from '../../src/mcp-client.js';
import { platformsDoctor } from '../../src/mcp-tools/platforms-tools.js';
import { runPlatformsDoctor } from '../../src/platform-adapters/operations.js';

describe('platforms MCP doctor', () => {
  it('is callable and included in the default advertised roster', async () => {
    expect((await getAllMCPTools()).map((tool) => tool.name)).toContain('platforms_doctor');
    expect((await listMCPTools()).map((tool) => tool.name)).toContain('platforms_doctor');
  });

  it('returns the same evidence-gated report as the read-only doctor domain API', async () => {
    const expected = await runPlatformsDoctor({ platform: 'codex', scope: 'project', path: process.cwd() });
    const result = await platformsDoctor.handler({ platform: 'codex', scope: 'project' }, { cwd: process.cwd() });

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual(expected);
  });
});
