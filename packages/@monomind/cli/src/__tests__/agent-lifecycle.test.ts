import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnCommand,
  listCommand,
  statusCommand,
  stopCommand,
  getAgentCapabilities,
  formatStatus,
} from '../commands/agent-lifecycle.js';
import type { CommandContext, CommandResult } from '../types.js';

// callMCPTool is NOT mocked here: agent spawn/list/status/stop route through
// the real in-process MCP tool registry (src/mcp-client.ts -> agent-tools.ts),
// which is exactly what CLAUDE.md documents ("execute MCP tool handlers
// directly in-process ... they do not require a running mcp start server").
// Driving the real handlers against a real temp-dir store is closer to
// production behavior than mocking callMCPTool, and it's what actually
// exercises the on-disk persistence this suite cares about.

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [] },
    cwd: process.cwd(),
    interactive: false,
    ...overrides,
  };
}

let dir: string;
let originalCwd: () => string;
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-lifecycle-test-'));
  // A plain (non-git) temp dir makes getMonomindDataRoot() fall back to
  // <dir>/.monomind — see src/mcp-tools/types.ts getMonomindDataRoot().
  process.env.MONOMIND_CWD = dir;
  // updateSwarmActivityMetrics() (agent-lifecycle.ts L15-43) uses
  // process.cwd() directly rather than getProjectCwd()/MONOMIND_CWD, so it
  // must be stubbed separately for the swarm-activity.json side effect to
  // land in the temp dir instead of the real repo.
  originalCwd = process.cwd;
  process.cwd = () => dir;
  // Silence the formatted CLI output (tables/boxes) so test output stays legible;
  // behavior is asserted against returned CommandResult + the real store file.
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  writeSpy.mockRestore();
  process.cwd = originalCwd;
  delete process.env.MONOMIND_CWD;
  rmSync(dir, { recursive: true, force: true });
});

function storePath(): string {
  return join(dir, '.monomind', 'agents', 'store.json');
}

function readStore(): { agents: Record<string, unknown>; version: string } {
  return JSON.parse(readFileSync(storePath(), 'utf-8'));
}

describe('spawnCommand', () => {
  it('persists a spawned agent to the real on-disk store with the correct shape', async () => {
    const result = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'test-agent', _: [] } })) as CommandResult
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ agentType: 'coder', status: 'spawned' });
    const agentId = (result.data as { agentId: string }).agentId;
    expect(typeof agentId).toBe('string');

    expect(existsSync(storePath())).toBe(true);
    const store = readStore();
    expect(Object.keys(store.agents)).toEqual([agentId]);
    const record = store.agents[agentId] as Record<string, unknown>;
    expect(record.agentType).toBe('coder');
    expect(record.status).toBe('idle'); // on-disk status differs from the CLI-facing "spawned" response
    expect(record.taskCount).toBe(0);
    expect(record.health).toBe(1);
  });

  it('auto-generates a name when --name is omitted and returns a CommandResult with data', async () => {
    const result = (await spawnCommand.action!(makeCtx({ flags: { type: 'researcher', _: [] } })) as CommandResult);
    expect(result.success).toBe(true);
    const store = readStore();
    expect(Object.values(store.agents)).toHaveLength(1);
    expect((Object.values(store.agents)[0] as { agentType: string }).agentType).toBe('researcher');
  });

  it('fails with exitCode 1 and does not touch the store when --type is missing and there is no --task to route from', async () => {
    const result = (await spawnCommand.action!(makeCtx({ flags: { _: [] } })) as CommandResult);
    expect(result).toEqual({ success: false, exitCode: 1 });
    expect(existsSync(storePath())).toBe(false);
  });

  it('records swarm activity metrics on spawn (separate side-effect file from the agent store)', async () => {
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'metrics-agent', _: [] } })) as CommandResult);
    const activityPath = join(dir, '.monomind', 'metrics', 'swarm-activity.json');
    expect(existsSync(activityPath)).toBe(true);
    const activity = JSON.parse(readFileSync(activityPath, 'utf-8'));
    expect(activity.swarm.agent_count).toBe(1);
    expect(activity.swarm.active).toBe(true);
  });
});

describe('listCommand', () => {
  it('reports zero agents against an empty/nonexistent store', async () => {
    const result = (await listCommand.action!(makeCtx()) as CommandResult);
    expect(result.success).toBe(true);
    expect((result.data as { agents: unknown[]; total: number }).agents).toEqual([]);
    expect((result.data as { total: number }).total).toBe(0);
  });

  it('lists a single spawned agent', async () => {
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'solo', _: [] } })) as CommandResult);
    const result = (await listCommand.action!(makeCtx()) as CommandResult);
    const data = result.data as { agents: Array<{ agentType: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.agents[0].agentType).toBe('coder');
  });

  it('lists multiple agents', async () => {
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'c1', _: [] } })) as CommandResult);
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'c2', _: [] } })) as CommandResult);
    (await spawnCommand.action!(makeCtx({ flags: { type: 'tester', name: 't1', _: [] } })) as CommandResult);

    const all = (await listCommand.action!(makeCtx()) as CommandResult);
    const allData = all.data as { agents: Array<{ agentType: string }>; total: number };
    expect(allData.total).toBe(3);
    expect(allData.agents.map((a) => a.agentType).sort()).toEqual(['coder', 'coder', 'tester']);
  });

  it('--type filters by agent type', async () => {
    // Regression test: listCommand (agent-lifecycle.ts) passes
    // `agentType: ctx.flags.type` to the agent_list MCP tool, but
    // agent_list's handler used to only ever read `input.status` and
    // `input.domain` — it never looked at `agentType`, so `agent list
    // --type tester` silently returned every agent regardless of type.
    // Fixed by adding the agentType filter to agent_list's handler.
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'c1', _: [] } })) as CommandResult);
    (await spawnCommand.action!(makeCtx({ flags: { type: 'tester', name: 't1', _: [] } })) as CommandResult);

    const filtered = (await listCommand.action!(makeCtx({ flags: { type: 'tester', _: [] } })) as CommandResult);
    const filteredData = filtered.data as { agents: Array<{ agentType: string }>; total: number };
    expect(filteredData.total).toBe(1);
    expect(filteredData.agents[0].agentType).toBe('tester');
  });

  it('--all includes terminated agents instead of silently returning zero agents', async () => {
    // Regression test: listCommand sends `status: 'all'` for --all, but
    // agent_list's handler used to treat any truthy `input.status` as a
    // literal value to filter on — `a.status === 'all'` never matches any
    // real agent, so --all silently returned zero agents. Fixed by treating
    // the 'all' sentinel as "no status filter" instead.
    const spawned = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'to-terminate', _: [] } })) as CommandResult
    );
    const agentId = (spawned.data as { agentId: string }).agentId;
    await stopCommand.action!(makeCtx({ args: [agentId], flags: { force: true, _: [] } }));

    const withoutAll = (await listCommand.action!(makeCtx()) as CommandResult);
    expect((withoutAll.data as { total: number }).total).toBe(0);

    const withAll = (await listCommand.action!(makeCtx({ flags: { all: true, _: [] } })) as CommandResult);
    expect((withAll.data as { total: number }).total).toBe(1);
  });

  // --- Corrupt-store behavior -------------------------------------------------
  //
  // KNOWN DATA-LOSS-SHAPED PATTERN (flagged, not fixed — see task instructions):
  //
  // src/mcp-tools/agent-tools.ts:61-76 loadAgentStore() swallows *any* read/parse
  // failure (not just ENOENT) and silently returns an empty in-memory store
  // `{ agents: {}, version: '3.0.0' }`. Every mutating handler in that file
  // (agent_spawn L231, agent_terminate L278, agent_update L605, agent_pool's
  // scale/drain L460/L483) then calls saveAgentStore(store) unconditionally,
  // which overwrites the real store.json on disk with whatever the mutated
  // (empty-based) in-memory store now contains.
  //
  // This is the exact same shape as the bug regression-tested for task_assign in
  // task-tools-agent-store.test.ts ("corrupt read -> falls back to empty ->
  // later overwrite wipes the real file"), except agent-tools.ts's own handlers
  // were never given the `agentStoreSyncSkipped`-style guard that task-tools.ts
  // received. The two tests below document the CLI-visible and on-disk
  // consequences as they exist today.
  it('a corrupt store.json is silently reported as "0 agents" instead of a surfaced read error', async () => {
    (await spawnCommand.action!(makeCtx({ flags: { type: 'coder', name: 'will-be-hidden', _: [] } })) as CommandResult);
    expect(readStore().agents).not.toEqual({});

    mkdirSync(join(dir, '.monomind', 'agents'), { recursive: true });
    writeFileSync(storePath(), '{ not valid json !!', 'utf-8');

    const result = (await listCommand.action!(makeCtx()) as CommandResult);
    // Current behavior: success:true with an empty list — indistinguishable
    // from "no agents have ever been spawned". No error is surfaced to the
    // CLI caller even though the real store on disk could not be read.
    expect(result.success).toBe(true);
    expect((result.data as { agents: unknown[]; total: number }).agents).toEqual([]);
    expect((result.data as { total: number }).total).toBe(0);
  });

  it('spawning after the store is corrupted refuses to save, leaving the real data untouched', async () => {
    // Regression test: this used to silently discard every previously-
    // persisted agent (loadAgentStore() fell back to an empty store on any
    // read failure, and the handler unconditionally saved that empty-based
    // result back). Fixed by having write handlers use loadAgentStoreOrNull()
    // and bail out instead of proceeding — same pattern as task-tools.ts's
    // task_assign fix earlier this session.
    const first = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'agent-a', _: [] } })) as CommandResult
    );
    const firstId = (first.data as { agentId: string }).agentId;
    expect(readStore().agents[firstId]).toBeDefined();

    const corrupt = '{ not valid json !!';
    writeFileSync(storePath(), corrupt, 'utf-8');

    const second = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'agent-b', _: [] } })) as CommandResult
    );
    expect(second.success).toBe(false);

    // The corrupt file must be exactly what it was — not overwritten with a
    // fresh store containing only agent-b (which would silently drop agent-a).
    expect(readFileSync(storePath(), 'utf-8')).toBe(corrupt);
  });
});

describe('statusCommand', () => {
  it('returns full status + metrics for an existing agent', async () => {
    const spawned = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'status-target', _: [] } })) as CommandResult
    );
    const agentId = (spawned.data as { agentId: string }).agentId;

    const result = (await statusCommand.action!(makeCtx({ args: [agentId] })) as CommandResult);
    expect(result.success).toBe(true);
    const data = result.data as { agentId: string; agentType: string; status: string };
    expect(data.agentId).toBe(agentId);
    expect(data.agentType).toBe('coder');
    expect(data.status).toBe('idle');
  });

  it('requires an agent ID (non-interactive) and fails with exitCode 1 when missing', async () => {
    const result = (await statusCommand.action!(makeCtx()) as CommandResult);
    expect(result).toEqual({ success: false, exitCode: 1 });
  });

  it('reports failure (not success) for an unknown agent ID', async () => {
    // Regression test: agent_status (agent-tools.ts) resolves with
    // { status: 'not_found', error: ... } rather than throwing; statusCommand
    // now explicitly checks status.error instead of relying on a thrown
    // exception, so this correctly surfaces as a failure.
    const result = (await statusCommand.action!(makeCtx({ args: ['does-not-exist'] })) as CommandResult);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe('stopCommand', () => {
  it('terminates an existing agent and updates the store + swarm activity metrics', async () => {
    const spawned = (await spawnCommand.action!(
      makeCtx({ flags: { type: 'coder', name: 'stop-target', _: [] } })) as CommandResult
    );
    const agentId = (spawned.data as { agentId: string }).agentId;

    const result = (await stopCommand.action!(makeCtx({ args: [agentId], flags: { force: true, _: [] } })) as CommandResult);
    expect(result.success).toBe(true);
    expect((result.data as { terminated: boolean }).terminated).toBe(true);

    const store = readStore();
    expect((store.agents[agentId] as { status: string }).status).toBe('terminated');

    const activityPath = join(dir, '.monomind', 'metrics', 'swarm-activity.json');
    const activity = JSON.parse(readFileSync(activityPath, 'utf-8'));
    // spawn (+1) then stop (-1) nets to 0.
    expect(activity.swarm.agent_count).toBe(0);
  });

  it('requires an agent ID and fails with exitCode 1 when missing', async () => {
    const result = (await stopCommand.action!(makeCtx({ flags: { force: true, _: [] } })) as CommandResult);
    expect(result).toEqual({ success: false, exitCode: 1 });
  });

  it('reports failure (not success) for an agent that does not exist', async () => {
    // Regression test: agent_terminate (agent-tools.ts) resolves with
    // { success:false, error:'Agent not found' } rather than throwing;
    // stopCommand now explicitly checks result.success instead of relying on
    // a thrown exception, so this correctly surfaces as a failure.
    const result = (await stopCommand.action!(
      makeCtx({ args: ['ghost-agent'], flags: { force: true, _: [] } })) as CommandResult
    );
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe('shared helpers', () => {
  it('getAgentCapabilities returns a known capability set for documented types and a general fallback otherwise', () => {
    expect(getAgentCapabilities('coder')).toEqual(['code-generation', 'refactoring', 'debugging', 'testing']);
    expect(getAgentCapabilities('totally-unknown-type')).toEqual(['general']);
  });

  it('formatStatus maps known statuses to their formatted variants and passes unknown values through', () => {
    expect(formatStatus('active')).toContain('active');
    expect(formatStatus('idle')).toContain('idle');
    expect(formatStatus('stopped')).toContain('stopped');
    expect(formatStatus('something-else')).toBe('something-else');
  });
});
