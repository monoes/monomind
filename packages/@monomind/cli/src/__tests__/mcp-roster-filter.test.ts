import { describe, expect, it } from 'vitest';
import { callMCPTool, hasTool, listMCPTools, searchNonCoreTools } from '../mcp-client.js';

/**
 * The default `tools/list` advertises only a lean core roster (issue #410) to
 * keep the per-call schema payload small. Non-core tools stay callable by name
 * and discoverable via monomind_tool_search. MONOMIND_MCP_FULL=1 restores the
 * full roster, but that env var is read at module load — these tests run in
 * the default (core) mode; mcp-roster-full.test.ts covers FULL=1.
 */
const CORE = [
  'monograph_build',
  'monograph_query',
  'monograph_suggest',
  'monograph_brief',
  'monograph_impact',
  'monograph_context',
  'monograph_neighbors',
  'pick',
  'org_skill_show',
  'monomind_tool_search',
  'knowledge_search',
  'knowledge_ingest',
  'monodesign_detect',
  'monodesign_fix',
  'monodesign_palette',
];

const PLACEBO_PREFIXES = [
  'agent_',
  'task_',
  'session_',
  'config_',
  'system_',
  'guidance_',
  'hooks_',
];

describe('MCP core-roster filter', () => {
  it('advertises the lean core set', async () => {
    const names = new Set((await listMCPTools()).map((t) => t.name));
    for (const name of CORE) expect(names.has(name), name).toBe(true);
  });

  it('does not advertise state-file tools (agent_/task_/session_/config_/system_/guidance_/hooks_, mcp_status)', async () => {
    const names = (await listMCPTools()).map((t) => t.name);
    const leaked = names.filter((n) => PLACEBO_PREFIXES.some((p) => n.startsWith(p)));
    expect(leaked).toEqual([]);
    expect(names).not.toContain('mcp_status');
    // Non-core categories stay unadvertised too.
    expect(names).not.toContain('browser_open');
    expect(names).not.toContain('github_pr_manage');
  });

  it('keeps the advertised schema payload under a byte budget', async () => {
    const tools = await listMCPTools();
    const payload = JSON.stringify({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    expect(tools.length).toBeLessThanOrEqual(25);
    expect(Buffer.byteLength(payload)).toBeLessThan(16_000);
  });

  it('keeps hidden tools callable by name', async () => {
    expect(await hasTool('system_info')).toBe(true);
    const result = await callMCPTool<Record<string, unknown>>('system_info', {});
    expect(result).toBeDefined();
  });

  it('makes non-core tools discoverable via searchNonCoreTools', async () => {
    const browserHits = await searchNonCoreTools('browser open page navigate', undefined, 5);
    expect(browserHits.some((t) => t.name === 'browser_open')).toBe(true);
    for (const t of browserHits) {
      expect(t.inputSchema).toBeDefined();
      expect(t.category).toBe('browser');
    }
    // Newly hidden state-file tools are discoverable as well.
    const agentHits = await searchNonCoreTools('spawn agent', 'agent', 5);
    expect(agentHits.some((t) => t.name === 'agent_spawn')).toBe(true);
  });
});
