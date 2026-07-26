/**
 * Regression coverage: the CLI and the MCP tools must resolve the SAME data root.
 *
 * `swarm status` / `swarm init` / `swarm stop` used to build their state paths as
 * `path.join(process.cwd(), '.monomind/swarm', ...)` and
 * `path.join(process.cwd(), '.monomind/agents/store.json')`, while every MCP tool
 * (agent-tools.ts, swarm-tools.ts, task-tools.ts, ...) resolves through
 * `getMonomindDataRoot()` — which, inside a git repo, is `<repo>/.git/monomind`.
 *
 * The two only coincide when there is no `.git` at all (which is why the existing
 * swarm.test.ts suite, running in a bare tmpdir, never caught this). In a real
 * repository the CLI read an empty/parallel store: `swarm status` reported
 * "0 agents" with agents genuinely on disk, and `swarm init` wrote a second,
 * divergent copy of swarm-state.json that no MCP tool ever read.
 *
 * These tests therefore run in a tmpdir with a real `.git` DIRECTORY so the two
 * roots diverge — the only configuration in which the bug is observable.
 * They use the real filesystem and the real in-process MCP tool handlers; nothing
 * about the store layer is mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swarmCommand } from '../commands/swarm.js';
import { listCommand, spawnCommand } from '../commands/agent-lifecycle.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

function findSub(name: string): Command {
  const sub = swarmCommand.subcommands?.find((s) => s.name === name);
  if (!sub) throw new Error(`swarm subcommand not found: ${name}`);
  return sub;
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { args: [], flags: { _: [] }, cwd: process.cwd(), interactive: false, ...overrides };
}

let dir: string;
let originalCwd: () => string;
let writeSpy: ReturnType<typeof vi.spyOn>;
let savedDataDir: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'swarm-data-root-'));
  // A real .git DIRECTORY — this is what makes getMonomindDataRoot() resolve to
  // <dir>/.git/monomind instead of <dir>/.monomind.
  mkdirSync(join(dir, '.git'), { recursive: true });
  savedDataDir = process.env.MONOMIND_DATA_DIR;
  delete process.env.MONOMIND_DATA_DIR; // must not short-circuit the git resolution
  process.env.MONOMIND_CWD = dir;
  originalCwd = process.cwd;
  process.cwd = () => dir;
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  writeSpy.mockRestore();
  process.cwd = originalCwd;
  delete process.env.MONOMIND_CWD;
  if (savedDataDir === undefined) delete process.env.MONOMIND_DATA_DIR;
  else process.env.MONOMIND_DATA_DIR = savedDataDir;
  rmSync(dir, { recursive: true, force: true });
});

describe('data-root agreement between the swarm CLI and the MCP tools', () => {
  it('resolves the canonical root under .git/monomind (precondition for the rest)', () => {
    expect(getMonomindDataRoot(dir)).toBe(join(dir, '.git', 'monomind'));
  });

  it('swarm status counts agents written by the real agent_spawn MCP path', async () => {
    await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'x', _: [] } }));
    await spawnCommand.action!(makeCtx({ flags: { type: 'tester', name: 'y', _: [] } }));

    // Sanity: the agents really are on disk, under the canonical root.
    const storePath = join(getMonomindDataRoot(dir), 'agents', 'store.json');
    expect(existsSync(storePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(Object.keys(onDisk.agents)).toHaveLength(2);

    const result = (await findSub('status').action!(makeCtx())) as CommandResult;
    const data = result.data as { agents: { total: number; active: number } };
    expect(data.agents.total).toBe(2);
    expect(data.agents.active).toBe(2);
  });

  it('swarm status reads swarm state written by the swarm_init MCP tool (no second copy)', async () => {
    const { swarmTools } = await import('../mcp-tools/swarm-tools.js');
    const initTool = swarmTools.find((t) => t.name === 'swarm_init')!;
    const init = (await initTool.handler({ topology: 'mesh', maxAgents: 4 })) as { swarmId: string };

    const result = (await findSub('status').action!(makeCtx())) as CommandResult;
    const data = result.data as { id: string; topology: string; hasActiveSwarm: boolean };
    expect(data.hasActiveSwarm).toBe(true);
    expect(data.id).toBe(init.swarmId);
    expect(data.topology).toBe('mesh');
  });

  it('swarm init persists into the canonical root, not a parallel <cwd>/.monomind copy', async () => {
    await findSub('init').action!(makeCtx({ flags: { topology: 'hierarchical', 'max-agents': 8, _: [] } }));

    const canonical = join(getMonomindDataRoot(dir), 'swarm', 'swarm-state.json');
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(join(dir, '.monomind', 'swarm', 'swarm-state.json'))).toBe(false);

    // And the MCP-side reader sees exactly that swarm.
    const { swarmTools } = await import('../mcp-tools/swarm-tools.js');
    const statusTool = swarmTools.find((t) => t.name === 'swarm_status')!;
    const mcpStatus = (await statusTool.handler({})) as { swarmId?: string; status: string; topology?: string };
    expect(mcpStatus.status).not.toBe('no_swarm');
    expect(mcpStatus.topology).toBe('hierarchical');

    // The CLI's own status reads the same record back.
    const cliStatus = (await findSub('status').action!(makeCtx())) as CommandResult;
    expect((cliStatus.data as { id: string }).id).toBe(mcpStatus.swarmId);
  });

  it('migrates a pre-existing legacy <cwd>/.monomind swarm state instead of orphaning it', async () => {
    const legacyDir = join(dir, '.monomind', 'swarm');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, 'swarm-state.json'),
      JSON.stringify({
        version: '3.0.0',
        swarms: {
          'swarm-legacy': {
            swarmId: 'swarm-legacy', topology: 'ring', status: 'running',
            updatedAt: '2030-01-01T00:00:00.000Z',
          },
        },
      }),
    );

    const result = (await findSub('status').action!(makeCtx())) as CommandResult;
    const data = result.data as { id: string; topology: string; hasActiveSwarm: boolean };
    expect(data.hasActiveSwarm).toBe(true);
    expect(data.id).toBe('swarm-legacy');
    expect(data.topology).toBe('ring');
  });
});

describe('agent list ID column', () => {
  it('renders the agentId returned by agent_list instead of a blank cell', async () => {
    const spawned = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'x', _: [] } }),
    )) as CommandResult;
    const spawnedId = (spawned.data as { agentId?: string; id?: string }).agentId
      ?? (spawned.data as { id?: string }).id;
    expect(typeof spawnedId).toBe('string');
    expect(spawnedId).toBeTruthy();

    const tableSpy = vi.spyOn(output, 'printTable').mockImplementation(() => undefined);
    try {
      const result = (await listCommand.action!(makeCtx())) as CommandResult;
      expect(result.success).toBe(true);
      expect(tableSpy).toHaveBeenCalled();
      const rows = tableSpy.mock.calls[0][0].data as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(spawnedId);
      expect(rows[0].type).toBe('coder');
    } finally {
      tableSpy.mockRestore();
    }
  });
});
