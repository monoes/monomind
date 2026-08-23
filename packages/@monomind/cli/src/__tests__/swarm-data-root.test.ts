/**
 * Regression coverage: the CLI and the MCP tools must resolve the SAME data root.
 *
 * `monoswarm status` / `monoswarm init` / `monoswarm stop` used to build their state
 * paths as `path.join(process.cwd(), '.monomind/swarm', ...)` and
 * `path.join(process.cwd(), '.monomind/agents/store.json')`, while every MCP tool
 * (agent-tools.ts, monoswarm-tools.ts, task-tools.ts, ...) resolves through
 * `getMonomindDataRoot()` — which, inside a git repo, is `<repo>/.git/monomind`.
 *
 * The two only coincide when there is no `.git` at all (which is why the existing
 * monoswarm.test.ts suite, running in a bare tmpdir, never caught this). In a real
 * repository the CLI read an empty/parallel store: `monoswarm status` reported
 * "0 agents" with agents genuinely on disk, and `monoswarm init` wrote a second,
 * divergent copy of state.json that no MCP tool ever read.
 *
 * These tests therefore run in a tmpdir with a real `.git` DIRECTORY so the two
 * roots diverge — the only configuration in which the bug is observable.
 * They use the real filesystem and the real in-process MCP tool handlers; nothing
 * about the store layer is mocked.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCommand, spawnCommand } from '../commands/agent-lifecycle.js';
import { monoswarmCommand } from '../commands/monoswarm.js';
import { getMonomindDataRoot } from '../mcp-tools/types.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

function findSub(name: string): Command {
  const sub = monoswarmCommand.subcommands?.find((s) => s.name === name);
  if (!sub) throw new Error(`monoswarm subcommand not found: ${name}`);
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
  dir = mkdtempSync(join(tmpdir(), 'monoswarm-data-root-'));
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

describe('data-root agreement between the monoswarm CLI and the MCP tools', () => {
  it('resolves the canonical root under .git/monomind (precondition for the rest)', () => {
    expect(getMonomindDataRoot(dir)).toBe(join(dir, '.git', 'monomind'));
  });

  it('monoswarm status counts agents written by the real agent_spawn MCP path', async () => {
    await spawnCommand.action?.(makeCtx({ flags: { type: 'coder', name: 'x', _: [] } }));
    await spawnCommand.action?.(makeCtx({ flags: { type: 'tester', name: 'y', _: [] } }));

    // Sanity: the agents really are on disk, under the canonical root.
    const storePath = join(getMonomindDataRoot(dir), 'agents', 'store.json');
    expect(existsSync(storePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(Object.keys(onDisk.agents)).toHaveLength(2);

    const result = (await findSub('status').action?.(makeCtx())) as CommandResult;
    const data = result.data as { agents: { total: number; active: number } };
    expect(data.agents.total).toBe(2);
    expect(data.agents.active).toBe(2);
  });

  it('monoswarm status reads state written by the monoswarm_init MCP tool (no second copy)', async () => {
    const { monoswarmTools } = await import('../mcp-tools/monoswarm-tools.js');
    const initTool = monoswarmTools.find((t) => t.name === 'monoswarm_init')!;
    const init = (await initTool.handler({ topology: 'mesh', maxAgents: 4 })) as {
      monoswarmId: string;
    };

    const result = (await findSub('status').action?.(makeCtx())) as CommandResult;
    const data = result.data as { id: string; topology: string; hasActiveSwarm: boolean };
    expect(data.hasActiveSwarm).toBe(true);
    expect(data.id).toBe(init.monoswarmId);
    expect(data.topology).toBe('mesh');
  });

  it('monoswarm init persists into the canonical root, not a parallel <cwd>/.monomind copy', async () => {
    await findSub('init').action?.(
      makeCtx({ flags: { topology: 'hierarchical', 'max-agents': 8, _: [] } }),
    );

    const canonical = join(getMonomindDataRoot(dir), 'monoswarm', 'state.json');
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(join(dir, '.monomind', 'monoswarm', 'state.json'))).toBe(false);

    // And the MCP-side reader sees exactly that monoswarm.
    const { monoswarmTools } = await import('../mcp-tools/monoswarm-tools.js');
    const statusTool = monoswarmTools.find((t) => t.name === 'monoswarm_status')!;
    const mcpStatus = (await statusTool.handler({})) as {
      monoswarmId?: string;
      status: string;
      topology?: string;
    };
    expect(mcpStatus.status).toBe('running');
    expect(mcpStatus.topology).toBe('hierarchical');

    // The CLI's own status reads the same record back.
    const cliStatus = (await findSub('status').action?.(makeCtx())) as CommandResult;
    expect((cliStatus.data as { id: string }).id).toBe(mcpStatus.monoswarmId);
  });
});

describe('agent list ID column', () => {
  it('renders the agentId returned by agent_list instead of a blank cell', async () => {
    const spawned = (await spawnCommand.action?.(
      makeCtx({ flags: { type: 'coder', name: 'x', _: [] } }),
    )) as CommandResult;
    const spawnedId =
      (spawned.data as { agentId?: string; id?: string }).agentId ??
      (spawned.data as { id?: string }).id;
    expect(typeof spawnedId).toBe('string');
    expect(spawnedId).toBeTruthy();

    const tableSpy = vi.spyOn(output, 'printTable').mockImplementation(() => undefined);
    try {
      const result = (await listCommand.action?.(makeCtx())) as CommandResult;
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
