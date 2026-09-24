/**
 * The semantic route layer (`route semantic`, hooks_route_semantic,
 * `agent spawn --task`) answers with spawnable agent names, and
 * `agent spawn --task` spawns the agent it routed to.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callMCPTool = vi.fn();
vi.mock('../mcp-client.js', async (orig) => ({
  ...(await orig<typeof import('../mcp-client.js')>()),
  callMCPTool,
}));

const { createConfiguredRouteLayer } = await import('../routing/route-layer-factory.js');
const { spawnCommand } = await import('../commands/agent-lifecycle.js');

function agentNames(dir: string, out = new Set<string>()): Set<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) agentNames(f, out);
    else if (e.name.endsWith('.md')) {
      const n = readFileSync(f, 'utf8')
        .match(/^---\n([\s\S]*?)\n---/)?.[1]
        .match(/^name:\s*(.+)$/m)?.[1]
        .trim();
      if (n) out.add(n);
    }
  }
  return out;
}
const NAMES = agentNames(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'agents'),
);

beforeEach(() => {
  // Keep the hosted decision model out of the test: the keyword step decides.
  vi.stubEnv('MONOMIND_JEV', 'off');
  callMCPTool.mockReset().mockResolvedValue({
    agentId: 'a1',
    agentType: 'Security Engineer',
    status: 'active',
    createdAt: new Date().toISOString(),
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('route layer answers with spawnable agents', () => {
  it.each([
    ['Fix CVE-2024-12345 in the login handler', 'Security Engineer'],
    ['Update the Dockerfile base image', 'DevOps Automator'],
    ['write unit tests for the parser', 'tdd-london-monoswarm'],
  ])('%s → %s', async (task, expected) => {
    const layer = await createConfiguredRouteLayer();
    const result = await layer.route(task);
    expect(result.agentSlug).toBe(expected);
    expect(NAMES.has(result.agentSlug)).toBe(true);
  });
});

describe('agent spawn --task', () => {
  it('spawns the routed, real agent type', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const res = await spawnCommand.action?.({
      args: [],
      flags: { _: [], task: 'Fix CVE-2024-12345 in the login handler' },
      cwd: process.cwd(),
      interactive: false,
    } as never);
    stderr.mockRestore();
    expect(res?.success).toBe(true);
    const [tool, input] = callMCPTool.mock.calls[0];
    expect(tool).toBe('agent_spawn');
    expect(input.agentType).toBe('Security Engineer');
    expect(NAMES.has(input.agentType)).toBe(true);
  });
});
