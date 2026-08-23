/**
 * Deep coverage for src/commands/monoswarm.ts.
 *
 * `__tests__/commands.test.ts` and `__tests__/p1-commands.test.ts` already cover the
 * shallow "fails without required arg" paths for monoswarm subcommands via a heavy
 * `../src/mcp-client.js` mock. This file goes further:
 *
 *  - getAgentPlan(): pure function, exercised via `monoswarm start`'s printed
 *    "Agent Deployment Plan" table (captured through the mocked `output.printTable`),
 *    checked against the roles CLAUDE.md's "Agent Routing" table implies
 *    (coordinator/architect/coder/tester/reviewer for a development-style build).
 *  - monoswarm init / start: `monoswarm_init` is mocked here (this file mocks the
 *    whole MCP client), and monoswarm.ts intentionally does NOT duplicate any
 *    state-file write of its own anymore — the merged `monoswarm_init` MCP tool is
 *    the sole writer of `.monomind/monoswarm/state.json` (see
 *    `src/__tests__/swarm-data-root.test.ts` for real, unmocked coverage of that
 *    write). So this file's init/start tests assert the CommandResult and the
 *    calls made to the (mocked) MCP tool, not a persisted file.
 *  - monoswarm status: reads the real on-disk state file directly (status.ts has no
 *    MCP dependency) — tested both with and without an active monoswarm on disk,
 *    using the actual flat `MonoswarmState` shape `monoswarm_init` writes.
 *  - monoswarm stop / scale: confirm the MCP tool is invoked with the right
 *    arguments and that its result (success or failure) is surfaced faithfully in
 *    the CommandResult. State mutation on shutdown belongs to `monoswarm_shutdown`
 *    itself (real coverage lives in the MCP-tools test suite, not here).
 *  - Error paths: monoswarm_init/monoswarm_shutdown/monoswarm_scale rejecting is
 *    surfaced in the CommandResult (success:false / graceful degradation), never
 *    thrown or silently swallowed into a false "success".
 *
 * Style: real fs + a real temp directory that the process actually chdir()s into
 * (monoswarm.ts always resolves state paths off the live process.cwd(), there is no
 * ctx.cwd or env-var override to hook), matching src/__tests__/terminal-tools.test.ts
 * and src/__tests__/task-tools-agent-store.test.ts's preference for exercising real
 * behavior over mocking it away. The MCP client is mocked the same way
 * __tests__/commands.test.ts already does, since monoswarm.ts's own logic begins only
 * after that tool call returns.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../types.js';

// ---------------------------------------------------------------------------
// Mocks (same shape as __tests__/commands.test.ts)
// ---------------------------------------------------------------------------

const { monoswarmInitImpl, monoswarmShutdownImpl, monoswarmScaleImpl, MockMCPClientError } =
  vi.hoisted(() => {
    const monoswarmInitImpl = vi.fn(async (input: Record<string, unknown>) => ({
      monoswarmId: 'monoswarm-mock-123',
      topology: input.topology,
      strategy: 'specialized',
      maxAgents: input.maxAgents || 15,
      voteStrategy: 'majority',
      initializedAt: new Date().toISOString(),
      config: {
        topology: input.topology,
        maxAgents: input.maxAgents || 15,
      },
    }));

    const monoswarmShutdownImpl = vi.fn(async (_input?: Record<string, unknown>) => ({
      success: true,
      monoswarmId: 'monoswarm-mock-123',
      terminated: true,
    }));

    const monoswarmScaleImpl = vi.fn(
      async (
        input: Record<string, unknown>,
      ): Promise<{
        success: boolean;
        error?: string;
        monoswarmId?: unknown;
        previousCount: number;
        currentCount: unknown;
        spawned: string[];
        terminated: string[];
      }> => ({
        success: true,
        monoswarmId: 'monoswarm-mock-123',
        previousCount: 5,
        currentCount: input.targetAgents,
        spawned: Array.from(
          { length: Math.max(0, (input.targetAgents as number) - 5) },
          (_, i) => `agent-mock-${i}`,
        ),
        terminated: [],
      }),
    );

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

    return { monoswarmInitImpl, monoswarmShutdownImpl, monoswarmScaleImpl, MockMCPClientError };
  });

vi.mock('../mcp-client.js', () => ({
  callMCPTool: vi.fn(async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'monoswarm_init') return monoswarmInitImpl(input);
    if (toolName === 'monoswarm_shutdown') return monoswarmShutdownImpl(input);
    if (toolName === 'monoswarm_scale') return monoswarmScaleImpl(input);
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
import { monoswarmCommand } from '../commands/monoswarm.js';
import { output } from '../output.js';

// getAgentPlan is not exported — pull it in via require of the module's
// internals is not possible for ESM, so re-derive expectations by driving
// `monoswarm start`'s printed table (captured via the mocked output.printTable)
// instead of reaching into the private function directly.
function findSub(name: string) {
  const cmd = monoswarmCommand.subcommands?.find((c) => c.name === name);
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
  return path.join(cwd, '.monomind', 'monoswarm', 'state.json');
}

function writeState(cwd: string, state: Record<string, unknown>): void {
  const dir = path.join(cwd, '.monomind', 'monoswarm');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFilePath(cwd), JSON.stringify(state));
}

function lastPrintTableData(): Array<Record<string, unknown>> {
  const calls = (output.printTable as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const [lastCall] = calls.slice(-1);
  return (lastCall?.[0] as { data: Array<Record<string, unknown>> }).data;
}

// ---------------------------------------------------------------------------
// getAgentPlan (via `monoswarm start`, the only place it's driven from)
// ---------------------------------------------------------------------------
// monoswarm.ts's getAgentPlan() is an unexported pure function keyed by
// strategy name. `monoswarm start` renders it as the "Agent Deployment Plan"
// table (via output.printTable) and folds its total into the CommandResult's
// `agents` count — so we assert against both.

describe('monoswarm start agent plan generation (getAgentPlan)', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-monoswarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

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

      const result = await startCmd.action?.(ctx);

      expect(result?.success).toBe(true);
      expect(result?.data).toMatchObject({ agents: expectedTotal, strategy });

      const planRows = lastPrintTableData();
      expect(planRows.map((r) => r.role)).toEqual(expectedRoles);
      const total = planRows.reduce((sum, r) => sum + (r.count as number), 0);
      expect(total).toBe(expectedTotal);
    });
  }

  it('falls back to the "development" plan for an unrecognized strategy', async () => {
    const startCmd = findSub('start');
    const ctx = makeCtx({
      flags: { objective: 'Do something odd', strategy: 'not-a-real-strategy', _: [] },
    });

    const result = await startCmd.action?.(ctx);

    expect(result?.success).toBe(true);
    // development plan totals 8 agents (1+1+3+2+1)
    expect(result?.data).toMatchObject({ agents: 8 });
  });

  it('bug-fix-flavored routing (coordinator/researcher/coder/tester) is available via the "specialized" strategy', async () => {
    // CLAUDE.md's Agent Routing table maps "Bug Fix" work to
    // coordinator, researcher, coder, tester. monoswarm.ts has no literal
    // "bug fix" strategy key, but "specialized" is the closest available
    // mapping and a superset containing exactly those four roles (plus
    // architect/reviewer) — confirm they're all present.
    const startCmd = findSub('start');
    const ctx = makeCtx({
      flags: { objective: 'Fix the auth bug', strategy: 'specialized', _: [] },
    });

    const result = await startCmd.action?.(ctx);

    const planRows = lastPrintTableData();
    const types = planRows.map((r) => r.type);
    expect(result?.success).toBe(true);
    for (const role of ['coordinator', 'researcher', 'coder', 'tester']) {
      expect(types).toContain(role);
    }
  });
});

// ---------------------------------------------------------------------------
// monoswarm init — calls the MCP tool, does not duplicate its write
// ---------------------------------------------------------------------------

describe('monoswarm init', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-monoswarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('calls monoswarm_init with the resolved topology/maxAgents and surfaces its result', async () => {
    const initCmd = findSub('init');
    const ctx = makeCtx({ flags: { topology: 'mesh', 'max-agents': 6, _: [] } });

    const result = await initCmd.action?.(ctx);

    expect(monoswarmInitImpl).toHaveBeenCalledWith(
      expect.objectContaining({ topology: 'mesh', maxAgents: 6 }),
    );
    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ monoswarmId: 'monoswarm-mock-123', topology: 'mesh' });

    // monoswarm.ts does not write its own copy of the state file — the MCP
    // tool (mocked here, exercised for real in swarm-data-root.test.ts) is
    // the sole writer, so nothing should appear on disk from a mocked call.
    expect(fs.existsSync(stateFilePath(tmpCwd))).toBe(false);
  });

  it('v1Mode forces hierarchical-mesh topology regardless of --topology', async () => {
    const initCmd = findSub('init');
    const ctx = makeCtx({ flags: { topology: 'star', v1Mode: true, _: [] } });

    await initCmd.action?.(ctx);

    expect(monoswarmInitImpl).toHaveBeenCalledWith(
      expect.objectContaining({ topology: 'hierarchical-mesh' }),
    );
  });

  it('surfaces a thrown MCPClientError from monoswarm_init as a failed CommandResult, not a crash', async () => {
    monoswarmInitImpl.mockRejectedValueOnce(new MockMCPClientError('boom', 'monoswarm_init'));

    const initCmd = findSub('init');
    const result = await initCmd.action?.(makeCtx({ flags: { _: [] } }));

    expect(result).toEqual({ success: false, exitCode: 1 });
  });
});

// ---------------------------------------------------------------------------
// monoswarm status — reads real on-disk state
// ---------------------------------------------------------------------------

describe('monoswarm status reads real on-disk state', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-monoswarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('reports no active monoswarm when no state file exists', async () => {
    const statusCmd = findSub('status');
    const result = await statusCmd.action?.(makeCtx());

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({
      hasActiveSwarm: false,
      id: 'no-active-swarm',
      topology: 'none',
    });
  });

  it('reports the on-disk monoswarm state with agent counts from the agent store', async () => {
    writeState(tmpCwd, {
      monoswarmId: 'monoswarm-new',
      initialized: true,
      topology: 'hierarchical',
      status: 'running',
      agents: ['agent-1', 'agent-2', 'agent-3'],
      config: { strategy: 'development' },
      votes: { pending: [], history: [] },
      sharedMemory: {},
      notices: [],
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });

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
    const result = await statusCmd.action?.(makeCtx());

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({
      id: 'monoswarm-new',
      topology: 'hierarchical',
      strategy: 'development',
      hasActiveSwarm: true,
    });
    // agents-1/2 count as active (idle|busy), agent-3 (terminated) doesn't
    expect((result?.data as { agents: { total: number; active: number } }).agents).toMatchObject({
      total: 3,
      active: 2,
    });
  });

  it('an explicit swarmId arg overrides the displayed id without changing the rest of the report', async () => {
    writeState(tmpCwd, {
      monoswarmId: 'monoswarm-actual',
      initialized: true,
      topology: 'star',
      status: 'running',
      agents: [],
      config: { strategy: 'specialized' },
      votes: { pending: [], history: [] },
      sharedMemory: {},
      notices: [],
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });

    const statusCmd = findSub('status');
    const result = await statusCmd.action?.(makeCtx({ args: ['some-other-id'] }));

    expect(result?.data).toMatchObject({ id: 'some-other-id', topology: 'star' });
  });
});

// ---------------------------------------------------------------------------
// monoswarm stop — calls the MCP tool, surfaces success/failure
// ---------------------------------------------------------------------------

describe('monoswarm stop', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-monoswarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('calls monoswarm_shutdown with the given id/force and reports success', async () => {
    const stopCmd = findSub('stop');
    const result = await stopCmd.action?.(
      makeCtx({ args: ['monoswarm-123'], flags: { force: true, _: [] } }),
    );

    expect(monoswarmShutdownImpl).toHaveBeenCalledWith(
      expect.objectContaining({ swarmId: 'monoswarm-123', force: true }),
    );
    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ swarmId: 'monoswarm-123', stopped: true });
  });

  it('fails the CommandResult when the MCP shutdown call throws, rather than reporting a false success', async () => {
    monoswarmShutdownImpl.mockRejectedValueOnce(new Error('mcp unreachable'));

    const stopCmd = findSub('stop');
    const result = await stopCmd.action?.(
      makeCtx({ args: ['monoswarm-123'], flags: { force: true, _: [] } }),
    );

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// monoswarm scale — error surfacing
// ---------------------------------------------------------------------------

describe('monoswarm scale', () => {
  let tmpCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-monoswarm-test-'));
    process.chdir(tmpCwd);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('reports spawned/terminated agent deltas from a successful scale call', async () => {
    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action?.(
      makeCtx({ args: ['monoswarm-123'], flags: { agents: 8, _: [] } }),
    );

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ previousCount: 5, currentCount: 8 });
    expect((result?.data as { spawned: string[] }).spawned).toHaveLength(3);
  });

  it('surfaces a tool-level failure (result.success === false) as a failed CommandResult', async () => {
    monoswarmScaleImpl.mockResolvedValueOnce({
      success: false,
      error: 'monoswarm not found',
      previousCount: 0,
      currentCount: 0,
      spawned: [],
      terminated: [],
    });

    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action?.(
      makeCtx({ args: ['monoswarm-123'], flags: { agents: 8, _: [] } }),
    );

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it('surfaces a thrown error from monoswarm_scale as a failed CommandResult rather than crashing', async () => {
    monoswarmScaleImpl.mockRejectedValueOnce(
      new MockMCPClientError('scale failed', 'monoswarm_scale'),
    );

    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action?.(
      makeCtx({ args: ['monoswarm-123'], flags: { agents: 8, _: [] } }),
    );

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it('treats a target of 0 as valid (scale-to-zero), not a missing-arg error', async () => {
    const scaleCmd = findSub('scale');
    const result = await scaleCmd.action?.(
      makeCtx({ args: ['monoswarm-123'], flags: { agents: 0, _: [] } }),
    );

    // Should proceed to call the MCP tool rather than bailing out on
    // "Target agent count required" (0 is falsy but a legitimate value).
    expect(monoswarmScaleImpl).toHaveBeenCalledWith(expect.objectContaining({ targetAgents: 0 }));
    expect(result?.success).toBe(true);
  });
});
