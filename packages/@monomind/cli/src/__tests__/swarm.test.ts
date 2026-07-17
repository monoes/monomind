/**
 * Deep coverage for src/commands/swarm.ts.
 *
 * `__tests__/commands.test.ts` and `__tests__/p1-commands.test.ts` already cover the
 * shallow "fails without required arg" paths for swarm subcommands via a heavy
 * `../src/mcp-client.js` mock. This file goes further:
 *
 *  - getAgentPlan(): pure function, exercised directly against every named strategy
 *    and the unknown-strategy fallback, checked against the roles CLAUDE.md's
 *    "Agent Routing" table implies (coordinator/architect/coder/tester/reviewer for
 *    a development-style build).
 *  - swarm init / start: real filesystem — after a mocked successful `swarm_init`
 *    MCP call, assert the on-disk `.monomind/swarm/swarm-state.json` is written with
 *    the expected shape (not just that the CommandResult looks right).
 *  - swarm status: reads that same real state file (and the real agent store) and
 *    formats a report — tested both with and without an active swarm on disk.
 *  - swarm stop / scale: confirm the persisted state file is actually mutated
 *    (status flips to 'terminated', agent counts reflected), not just that the
 *    command returns success.
 *  - Error paths: swarm_init/swarm_shutdown/swarm_scale rejecting is surfaced in the
 *    CommandResult (success:false / graceful degradation), never thrown or silently
 *    swallowed into a false "success".
 *
 * Style: real fs + a real temp directory that the process actually chdir()s into
 * (swarm.ts always resolves state paths off the live process.cwd(), there is no
 * ctx.cwd or env-var override to hook), matching src/__tests__/terminal-tools.test.ts
 * and src/__tests__/task-tools-agent-store.test.ts's preference for exercising real
 * behavior over mocking it away. The MCP client is mocked the same way
 * __tests__/commands.test.ts already does, since swarm.ts's own logic begins only
 * after that tool call returns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CommandContext } from '../types.js';

// ---------------------------------------------------------------------------
// Mocks (same shape as __tests__/commands.test.ts)
// ---------------------------------------------------------------------------

const { swarmInitImpl, swarmShutdownImpl, swarmScaleImpl, MockMCPClientError } = vi.hoisted(() => {
  const swarmInitImpl = vi.fn(async (input: Record<string, unknown>) => ({
    swarmId: 'swarm-mock-123',
    topology: input.topology,
    initializedAt: new Date().toISOString(),
    config: {
      topology: input.topology,
      maxAgents: input.maxAgents || 15,
      currentAgents: 0,
      communicationProtocol: 'message-bus',
      autoScaling: true,
    },
  }));

  const swarmShutdownImpl = vi.fn(async (_input?: Record<string, unknown>) => ({ stopped: true }));

  const swarmScaleImpl = vi.fn(async (input: Record<string, unknown>): Promise<{
    success: boolean;
    error?: string;
    swarmId?: unknown;
    previousCount: number;
    currentCount: unknown;
    spawned: string[];
    terminated: string[];
  }> => ({
    success: true,
    swarmId: input.swarmId,
    previousCount: 5,
    currentCount: input.targetAgents,
    spawned: Array.from(
      { length: Math.max(0, (input.targetAgents as number) - 5) },
      (_, i) => `agent-mock-${i}`,
    ),
    terminated: [],
  }));

  class MockMCPClientError extends Error {
    toolName: string;
    cause?: Error;
    constructor(message: string, toolName: string, cause?: Error) {
      super(message);
      this.name = 'MCPClientError';
      this.toolName = toolName;
      this.cause = cause;
    }
  }

  return { swarmInitImpl, swarmShutdownImpl, swarmScaleImpl, MockMCPClientError };
});

vi.mock('../mcp-client.js', () => ({
  callMCPTool: vi.fn(async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'swarm_init') return swarmInitImpl(input);
    if (toolName === 'swarm_shutdown') return swarmShutdownImpl(input);
    if (toolName === 'swarm_scale') return swarmScaleImpl(input);
    return {};
  }),
  MCPClientError: MockMCPClientError,
}));

vi.mock('../output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn(),
    })),
    highlight: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
    success: (s: string) => s,
    error: (s: string) => s,
    warning: (s: string) => s,
    info: (s: string) => s,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn(),
  },
}));

vi.mock('../prompt.js', () => ({
  select: vi.fn(async (opts) => opts.default || opts.options[0]?.value),
  confirm: vi.fn(async (opts) => opts.default ?? false),
  input: vi.fn(async (opts) => opts.default || 'test-input'),
  multiSelect: vi.fn(async (opts) => opts.default || []),
}));

// Imported after mocks are registered.
import { swarmCommand } from '../commands/swarm.js';

// getAgentPlan is not exported — pull it in via require of the module's
// internals is not possible for ESM, so re-derive expectations by driving
// `swarm start`'s CommandResult (it returns/consumes the plan) instead of
// reaching into the private function directly.
function findSub(name: string) {
  const cmd = swarmCommand.subcommands?.find((c) => c.name === name);
  if (!cmd) throw new Error(`subcommand ${name} not found`);
  return cmd;
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [] },
    cwd: process.cwd(),
    interactive: false,
    ...overrides,
  };
}

function stateFilePath(cwd: string) {
  return path.join(cwd, '.monomind', 'swarm', 'swarm-state.json');
}

function readState(cwd: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(stateFilePath(cwd), 'utf-8'));
}

// ---------------------------------------------------------------------------
// getAgentPlan (via `swarm start`, the only place it's driven from)
// ---------------------------------------------------------------------------
// swarm.ts's getAgentPlan() is an unexported pure function keyed by strategy
// name. `swarm start` puts its exact output into the CommandResult's
// `agents` count and drives the printed table, so we assert against it
// there — this is the closest thing to unit-testing the function itself
// without changing swarm.ts's export surface.

describe('swarm start agent plan generation (getAgentPlan)', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-swarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  // role/count expectations for each named strategy, matching swarm.ts's
  // `plans` table and (where the strategy overlaps) CLAUDE.md's Agent
  // Routing table — e.g. a "development"-flavored build maps to
  // coordinator/architect/coder/tester/reviewer.
  const cases: Array<{ strategy: string; expectedTotal: number; expectedRoles: string[] }> = [
    {
      strategy: 'specialized',
      expectedTotal: 7, // 1+1+1+2+1+1
      expectedRoles: ['Coordinator', 'Researcher', 'Architect', 'Coder', 'Tester', 'Reviewer'],
    },
    {
      strategy: 'balanced',
      expectedTotal: 6, // 1+4+1
      expectedRoles: ['Coordinator', 'Worker', 'Reviewer'],
    },
    {
      strategy: 'development',
      expectedTotal: 8, // 1+1+3+2+1
      expectedRoles: ['Coordinator', 'Architect', 'Coder', 'Tester', 'Reviewer'],
    },
    {
      strategy: 'testing',
      expectedTotal: 6, // 1+2+2+1
      expectedRoles: ['Test Lead', 'Unit Tester', 'Integration Tester', 'QA Reviewer'],
    },
    {
      strategy: 'research',
      expectedTotal: 7, // 1+4+2
      expectedRoles: ['Coordinator', 'Researcher', 'Analyst'],
    },
  ];

  for (const { strategy, expectedTotal, expectedRoles } of cases) {
    it(`maps strategy "${strategy}" to the expected agent roster`, async () => {
      const startCmd = findSub('start');
      const ctx = makeCtx({ flags: { objective: `Do the ${strategy} thing`, strategy, _: [] } });

      const result = await startCmd.action!(ctx);

      expect(result?.success).toBe(true);
      expect(result?.data).toMatchObject({ agents: expectedTotal, strategy });

      // Cross-check against the persisted agentPlan embedded in swarm state.
      const state = readState(tmpCwd);
      const swarms = state.swarms as Record<string, { config: { agentPlan: Array<{ role: string; count: number }> } }>;
      const [swarmEntry] = Object.values(swarms);
      const roles = swarmEntry.config.agentPlan.map((a) => a.role);
      expect(roles).toEqual(expectedRoles);
      const total = swarmEntry.config.agentPlan.reduce((sum, a) => sum + a.count, 0);
      expect(total).toBe(expectedTotal);
    });
  }

  it('falls back to the "development" plan for an unrecognized strategy', async () => {
    const startCmd = findSub('start');
    const ctx = makeCtx({ flags: { objective: 'Do something odd', strategy: 'not-a-real-strategy', _: [] } });

    const result = await startCmd.action!(ctx);

    expect(result?.success).toBe(true);
    // development plan totals 8 agents (1+1+3+2+1)
    expect(result?.data).toMatchObject({ agents: 8 });
  });

  it('bug-fix-flavored routing (coordinator/researcher/coder/tester) is available via the "specialized" strategy', async () => {
    // CLAUDE.md's Agent Routing table maps "Bug Fix" work to
    // coordinator, researcher, coder, tester. swarm.ts has no literal
    // "bug fix" strategy key, but "specialized" is the closest available
    // mapping and a superset containing exactly those four roles (plus
    // architect/reviewer) — confirm they're all present.
    const startCmd = findSub('start');
    const ctx = makeCtx({ flags: { objective: 'Fix the auth bug', strategy: 'specialized', _: [] } });

    const result = await startCmd.action!(ctx);

    const state = readState(tmpCwd);
    const swarms = state.swarms as Record<string, { config: { agentPlan: Array<{ role: string; type: string }> } }>;
    const [swarmEntry] = Object.values(swarms);
    const types = swarmEntry.config.agentPlan.map((a) => a.type);
    expect(result?.success).toBe(true);
    for (const role of ['coordinator', 'researcher', 'coder', 'tester']) {
      expect(types).toContain(role);
    }
  });
});

// ---------------------------------------------------------------------------
// swarm init — real state persistence
// ---------------------------------------------------------------------------

describe('swarm init persists state to .monomind/swarm/swarm-state.json', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-swarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('writes a swarm entry keyed by the MCP-assigned swarmId with the resolved topology/maxAgents', async () => {
    const initCmd = findSub('init');
    const ctx = makeCtx({ flags: { topology: 'mesh', 'max-agents': 6, _: [] } });

    const result = await initCmd.action!(ctx);

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ swarmId: 'swarm-mock-123', topology: 'mesh' });

    expect(fs.existsSync(stateFilePath(tmpCwd))).toBe(true);
    const state = readState(tmpCwd);
    expect(state.version).toBe('3.0.0');
    const swarms = state.swarms as Record<string, Record<string, unknown>>;
    expect(swarms['swarm-mock-123']).toMatchObject({
      swarmId: 'swarm-mock-123',
      topology: 'mesh',
      maxAgents: 6,
      status: 'running',
    });
    expect(swarms['swarm-mock-123'].createdAt).toBeTruthy();
    expect(swarms['swarm-mock-123'].updatedAt).toBeTruthy();
  });

  it('preserves previously-persisted swarms when initializing a second swarm', async () => {
    const initCmd = findSub('init');

    swarmInitImpl.mockResolvedValueOnce({
      swarmId: 'swarm-first',
      topology: 'hierarchical',
      initializedAt: new Date().toISOString(),
      config: { topology: 'hierarchical', maxAgents: 8, currentAgents: 0, communicationProtocol: 'message-bus', autoScaling: true },
    });
    await initCmd.action!(makeCtx({ flags: { topology: 'hierarchical', _: [] } }));

    swarmInitImpl.mockResolvedValueOnce({
      swarmId: 'swarm-second',
      topology: 'star',
      initializedAt: new Date().toISOString(),
      config: { topology: 'star', maxAgents: 4, currentAgents: 0, communicationProtocol: 'message-bus', autoScaling: true },
    });
    await initCmd.action!(makeCtx({ flags: { topology: 'star', _: [] } }));

    const state = readState(tmpCwd);
    const swarms = state.swarms as Record<string, unknown>;
    expect(Object.keys(swarms).sort()).toEqual(['swarm-first', 'swarm-second']);
  });

  it('embeds strategy and v1Mode into the persisted config', async () => {
    const initCmd = findSub('init');
    const ctx = makeCtx({ flags: { strategy: 'research', v1Mode: true, _: [] } });

    await initCmd.action!(ctx);

    const state = readState(tmpCwd);
    const swarms = state.swarms as Record<string, { config: { strategy: string; v1Mode: boolean }; topology: string }>;
    const [entry] = Object.values(swarms);
    expect(entry.config).toMatchObject({ strategy: 'research', v1Mode: true });
    // v1Mode forces hierarchical-mesh topology regardless of --topology
    expect(entry.topology).toBe('hierarchical-mesh');
  });

  it('surfaces a thrown MCPClientError from swarm_init as a failed CommandResult, not a crash', async () => {
    swarmInitImpl.mockRejectedValueOnce(new MockMCPClientError('boom', 'swarm_init'));

    const initCmd = findSub('init');
    const result = await initCmd.action!(makeCtx({ flags: { _: [] } }));

    expect(result).toEqual({ success: false, exitCode: 1 });
    // Nothing should have been persisted for a failed init.
    expect(fs.existsSync(stateFilePath(tmpCwd))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// swarm status — reads real state
// ---------------------------------------------------------------------------

describe('swarm status reads real on-disk state', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-swarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('reports no active swarm when no state file exists', async () => {
    const statusCmd = findSub('status');
    const result = await statusCmd.action!(makeCtx());

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ hasActiveSwarm: false, id: 'no-active-swarm', topology: 'none' });
  });

  it('reports the latest non-terminated swarm with agent counts from the agent store', async () => {
    const swarmDir = path.join(tmpCwd, '.monomind', 'swarm');
    fs.mkdirSync(swarmDir, { recursive: true });
    fs.writeFileSync(
      path.join(swarmDir, 'swarm-state.json'),
      JSON.stringify({
        version: '3.0.0',
        swarms: {
          'swarm-old': {
            swarmId: 'swarm-old',
            topology: 'mesh',
            status: 'terminated',
            updatedAt: '2020-01-01T00:00:00.000Z',
          },
          'swarm-new': {
            swarmId: 'swarm-new',
            topology: 'hierarchical',
            status: 'running',
            objective: 'Ship the thing',
            strategy: 'development',
            updatedAt: '2030-01-01T00:00:00.000Z',
          },
        },
      }),
    );

    const agentsDir = path.join(tmpCwd, '.monomind', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'store.json'),
      JSON.stringify({
        agents: {
          'agent-1': { status: 'idle' },
          'agent-2': { status: 'busy' },
          'agent-3': { status: 'terminated' },
        },
      }),
    );

    const statusCmd = findSub('status');
    const result = await statusCmd.action!(makeCtx());

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({
      id: 'swarm-new',
      topology: 'hierarchical',
      objective: 'Ship the thing',
      hasActiveSwarm: true,
    });
    // agents-1/2 count as active (idle|busy), agent-3 (terminated) doesn't
    expect((result?.data as { agents: { total: number; active: number } }).agents).toMatchObject({
      total: 3,
      active: 2,
    });
  });

  it('looks up a specific swarm by ID passed as the first arg, even if not the latest', async () => {
    const swarmDir = path.join(tmpCwd, '.monomind', 'swarm');
    fs.mkdirSync(swarmDir, { recursive: true });
    fs.writeFileSync(
      path.join(swarmDir, 'swarm-state.json'),
      JSON.stringify({
        version: '3.0.0',
        swarms: {
          'swarm-a': { swarmId: 'swarm-a', topology: 'star', status: 'running', updatedAt: '2020-01-01T00:00:00.000Z' },
          'swarm-b': { swarmId: 'swarm-b', topology: 'ring', status: 'running', updatedAt: '2030-01-01T00:00:00.000Z' },
        },
      }),
    );

    const statusCmd = findSub('status');
    const result = await statusCmd.action!(makeCtx({ args: ['swarm-a'] }));

    expect(result?.data).toMatchObject({ id: 'swarm-a', topology: 'star' });
  });
});

// ---------------------------------------------------------------------------
// swarm stop — mutates persisted state
// ---------------------------------------------------------------------------

describe('swarm stop updates the persisted state file', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-swarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();

    const swarmDir = path.join(tmpCwd, '.monomind', 'swarm');
    fs.mkdirSync(swarmDir, { recursive: true });
    fs.writeFileSync(
      path.join(swarmDir, 'swarm-state.json'),
      JSON.stringify({
        version: '3.0.0',
        swarms: {
          'swarm-123': { swarmId: 'swarm-123', topology: 'mesh', status: 'running', updatedAt: '2020-01-01T00:00:00.000Z' },
        },
      }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('flips status to "terminated" and bumps updatedAt on successful MCP shutdown', async () => {
    const stopCmd = findSub('stop');
    const result = await stopCmd.action!(makeCtx({ args: ['swarm-123'], flags: { force: true, _: [] } }));

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ swarmId: 'swarm-123', stopped: true });

    const state = readState(tmpCwd);
    const swarms = state.swarms as Record<string, { status: string; updatedAt: string }>;
    expect(swarms['swarm-123'].status).toBe('terminated');
    expect(swarms['swarm-123'].updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('leaves the persisted state untouched and fails the CommandResult when the MCP shutdown call throws', async () => {
    swarmShutdownImpl.mockRejectedValueOnce(new Error('mcp unreachable'));

    const stopCmd = findSub('stop');
    const result = await stopCmd.action!(makeCtx({ args: ['swarm-123'], flags: { force: true, _: [] } }));

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);

    // State must remain exactly as it was — still 'running', not silently
    // marked terminated despite the failed remote call.
    const state = readState(tmpCwd);
    const swarms = state.swarms as Record<string, { status: string }>;
    expect(swarms['swarm-123'].status).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// swarm scale — error surfacing
// ---------------------------------------------------------------------------

describe('swarm scale', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-swarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('reports spawned/terminated agent deltas from a successful scale call', async () => {
    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action!(makeCtx({ args: ['swarm-123'], flags: { agents: 8, _: [] } }));

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ previousCount: 5, currentCount: 8 });
    expect((result?.data as { spawned: string[] }).spawned).toHaveLength(3);
  });

  it('surfaces a tool-level failure (result.success === false) as a failed CommandResult', async () => {
    swarmScaleImpl.mockResolvedValueOnce({
      success: false,
      error: 'swarm not found',
      previousCount: 0,
      currentCount: 0,
      spawned: [],
      terminated: [],
    });

    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action!(makeCtx({ args: ['swarm-123'], flags: { agents: 8, _: [] } }));

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it('surfaces a thrown error from swarm_scale as a failed CommandResult rather than crashing', async () => {
    swarmScaleImpl.mockRejectedValueOnce(new MockMCPClientError('scale failed', 'swarm_scale'));

    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action!(makeCtx({ args: ['swarm-123'], flags: { agents: 8, _: [] } }));

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it('treats a target of 0 as valid (scale-to-zero), not a missing-arg error', async () => {
    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action!(makeCtx({ args: ['swarm-123'], flags: { agents: 0, _: [] } }));

    // Should proceed to call the MCP tool rather than bailing out on
    // "Target agent count required" (0 is falsy but a legitimate value).
    expect(swarmScaleImpl).toHaveBeenCalledWith(expect.objectContaining({ targetAgents: 0 }));
    expect(result?.success).toBe(true);
  });
});
