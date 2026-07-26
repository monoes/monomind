/**
 * Command-level input handling for two of the least-covered files in the
 * package: `commands/performance.ts` (1.7% statements) and
 * `mcp-tools/browser-tools.ts` (1.6%).
 *
 * Neither can be covered end-to-end here — benchmarks take seconds and the
 * browser tools need a real Chrome — but the argument-handling and
 * no-session paths are where the defects were, and those run fine in-process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('performance benchmark suite flag', () => {
  let lines: string[];
  let restore: () => void;

  beforeEach(async () => {
    lines = [];
    const { output } = await import('../output.js');
    const spy = vi.spyOn(output, 'writeln').mockImplementation((t = '') => { lines.push(String(t)); });
    restore = () => spy.mockRestore();
  });

  afterEach(() => restore());

  const runBenchmark = async (flags: Record<string, unknown>) => {
    const { performanceCommand } = await import('../commands/performance.js');
    const bench = performanceCommand.subcommands?.find(s => s.name === 'benchmark');
    expect(bench?.action).toBeDefined();
    // Keep it to a single iteration: this test is about flag handling, not
    // benchmark output.
    return bench!.action!({ flags: { iterations: '1', warmup: '0', ...flags }, args: [] } as never);
  };

  it('warns when the requested suite is not a real suite', async () => {
    await runBenchmark({ suite: 'quick' });
    const warned = lines.some(l => /Unknown benchmark suite "quick"/.test(l));
    // Regression: `--suite quick` silently ran the full "all" suite and
    // reported "Running all benchmarks", discarding the user's choice with no
    // indication it had been ignored.
    expect(warned).toBe(true);
    expect(lines.some(l => /Valid suites: all, wasm, neural, memory, search/.test(l))).toBe(true);
  }, 120_000);

  it('does not warn for a valid suite', async () => {
    await runBenchmark({ suite: 'search' });
    expect(lines.some(l => /Unknown benchmark suite/.test(l))).toBe(false);
  }, 120_000);

  it('does not warn when no suite is given', async () => {
    await runBenchmark({});
    expect(lines.some(l => /Unknown benchmark suite/.test(l))).toBe(false);
  }, 120_000);
});

/**
 * Flags that were declared in a command's `options` array and then never read
 * from `ctx.flags`. Each one silently discarded what the user asked for.
 */
describe('declared-but-ignored flags', () => {
  let lines: string[];
  let tables: Record<string, unknown>[][];
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(async () => {
    lines = [];
    tables = [];
    const { output } = await import('../output.js');
    spies.push(vi.spyOn(output, 'writeln').mockImplementation((t = '') => { lines.push(String(t)); }));
    spies.push(vi.spyOn(output, 'printTable').mockImplementation((opts) => {
      tables.push((opts.data as Record<string, unknown>[] | undefined) ?? []);
    }));
    spies.push(vi.spyOn(output, 'printInfo').mockImplementation((t) => { lines.push(String(t)); }));
    spies.push(vi.spyOn(output, 'printError').mockImplementation((t) => { lines.push(String(t)); }));
  });

  afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });

  const runBottleneck = async (flags: Record<string, unknown>) => {
    const { performanceCommand } = await import('../commands/performance.js');
    const cmd = performanceCommand.subcommands?.find(s => s.name === 'bottleneck');
    expect(cmd?.action).toBeDefined();
    return cmd!.action!({ flags, args: [] } as never);
  };

  it('performance bottleneck --component restricts the report to that component', async () => {
    await runBottleneck({ component: 'Network' });
    const rows = tables.at(-1) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    // Regression: --component was parsed and dropped, so every component's
    // findings came back no matter what was requested.
    expect(rows.every(r => r.component === 'Network')).toBe(true);
  });

  it('performance bottleneck --component rejects an unknown component', async () => {
    const res = await runBottleneck({ component: 'nonsense' });
    expect(res).toMatchObject({ success: false });
    expect(lines.some(l => /Analyzed components:/.test(l))).toBe(true);
  });

  it('performance bottleneck --depth says so when the depth is not implemented', async () => {
    await runBottleneck({ depth: 'full' });
    expect(lines.some(l => /--depth full is not implemented/.test(l))).toBe(true);
  });

  it('performance bottleneck stays quiet at the default depth', async () => {
    await runBottleneck({});
    expect(lines.some(l => /is not implemented/.test(l))).toBe(false);
  });

  it('hooks notify --channel says so when the channel is not implemented', async () => {
    const { notifyCommand } = await import('../commands/hooks-extended-commands.js');
    await notifyCommand.action!({ flags: { message: 'hi', channel: 'slack' }, args: [] } as never);
    // Regression: `--channel slack` printed to the console with no hint that
    // nothing had been sent to Slack.
    expect(lines.some(l => /Channel "slack" is not implemented/.test(l))).toBe(true);
  });

  it('hooks notify stays quiet on the default console channel', async () => {
    const { notifyCommand } = await import('../commands/hooks-extended-commands.js');
    await notifyCommand.action!({ flags: { message: 'hi' }, args: [] } as never);
    expect(lines.some(l => /is not implemented/.test(l))).toBe(false);
  });

  /**
   * `security audit` derives its rows from `.swarm/*.json` in the working
   * directory, plus one AUDIT_RUN row appended per invocation. A test run in
   * the repo checkout may therefore see an empty `.swarm` and nothing but
   * AUDIT_RUN — under which `--filter AUDIT` passes vacuously. Seed a
   * throwaway cwd containing events that must match AND events that must not,
   * so the assertion can actually fail.
   */
  const withSeededAuditLog = async (fn: () => Promise<void>) => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-'));
    fs.mkdirSync(path.join(dir, '.swarm'));
    fs.writeFileSync(path.join(dir, '.swarm', 'swarm-state.json'), '{}');  // -> SWARM_ACTIVITY
    fs.writeFileSync(path.join(dir, '.swarm', 'session-1.json'), '{}');    // -> SESSION_UPDATE
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    try {
      await fn();
    } finally {
      cwd.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('security audit lists every seeded event type when unfiltered', async () => {
    const { auditCommand } = await import('../commands/security-misc.js');
    await withSeededAuditLog(async () => {
      await auditCommand.action!({ flags: {}, args: [] } as never);
    });
    const events = (tables.at(-1) ?? []).map(r => String(r.event)).sort();
    // Baseline for the filter test below: without --filter all three are present.
    expect(events).toEqual(['AUDIT_RUN', 'SESSION_UPDATE', 'SWARM_ACTIVITY']);
  });

  it('security audit --filter narrows the log to matching event types', async () => {
    const { auditCommand } = await import('../commands/security-misc.js');
    await withSeededAuditLog(async () => {
      await auditCommand.action!({ flags: { filter: 'SWARM' }, args: [] } as never);
    });
    const events = (tables.at(-1) ?? []).map(r => String(r.event));
    // Regression: --filter was parsed and dropped, so the full log came back.
    // SESSION_UPDATE and AUDIT_RUN exist in this log (see the test above) and
    // must be absent here — that is what makes this assertion discriminating.
    expect(events).toEqual(['SWARM_ACTIVITY']);
  });

  it('security audit --filter matches case-insensitively', async () => {
    const { auditCommand } = await import('../commands/security-misc.js');
    await withSeededAuditLog(async () => {
      await auditCommand.action!({ flags: { filter: 'session' }, args: [] } as never);
    });
    expect((tables.at(-1) ?? []).map(r => String(r.event))).toEqual(['SESSION_UPDATE']);
  });

  it('security audit --filter reports when nothing matches', async () => {
    const { auditCommand } = await import('../commands/security-misc.js');
    await withSeededAuditLog(async () => {
      await auditCommand.action!({ flags: { filter: 'NOSUCHEVENT' }, args: [] } as never);
    });
    expect(lines.some(l => /No audit events match "NOSUCHEVENT"/.test(l))).toBe(true);
    expect(lines.some(l => /AUDIT_RUN, SESSION_UPDATE, SWARM_ACTIVITY/.test(l))).toBe(true);
    expect(tables).toEqual([]);
  });

  /**
   * `--action log|export|clear` were advertised in the option description and
   * the examples but never implemented — the command listed the log whatever
   * you passed. Unlike `--suite` on `performance benchmark` (where ignoring
   * the value still produces a valid superset of what was asked for), these
   * name a *different operation*: `security audit -a export > audit.json`
   * would write a decorated console table into a file the caller believes is
   * an export, and `-a clear` would report success having cleared nothing.
   * So this rejects with exit 1 rather than warning and continuing.
   */
  for (const action of ['log', 'export', 'clear']) {
    it(`security audit --action ${action} is rejected instead of silently listing`, async () => {
      const { auditCommand } = await import('../commands/security-misc.js');
      const res = await auditCommand.action!({ flags: { action }, args: [] } as never) as
        { success: boolean; exitCode?: number; message?: string };
      // index.ts calls process.exit(result.exitCode || 1) for !success, so this
      // pair is what makes the shell see a non-zero status.
      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(1);
      expect(res.message).toBe(`Unsupported action: ${action}`);
      expect(lines.some(l => new RegExp(`--action ${action} is not implemented`).test(l))).toBe(true);
      // And no log was printed, so nothing can be mistaken for the output of
      // the requested operation.
      expect(tables).toEqual([]);
    });
  }

  it('security audit --action list is accepted', async () => {
    const { auditCommand } = await import('../commands/security-misc.js');
    const res = await auditCommand.action!({ flags: { action: 'list' }, args: [] } as never);
    expect(res).toMatchObject({ success: true });
    expect(lines.some(l => /is not implemented/.test(l))).toBe(false);
  });

  it('security audit with no --action is accepted', async () => {
    const { auditCommand } = await import('../commands/security-misc.js');
    const res = await auditCommand.action!({ flags: {}, args: [] } as never);
    expect(res).toMatchObject({ success: true });
    expect(lines.some(l => /is not implemented/.test(l))).toBe(false);
  });
});

describe('browse workflow run --items', () => {
  it('passes the parsed items file through to the engine', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-items-'));
    const itemsPath = path.join(dir, 'items.json');
    await fs.writeFile(itemsPath, JSON.stringify([{ data: { a: 1 } }, { data: { a: 2 } }, { a: 3 }]));

    const runWorkflow = vi.fn(async (_wf: unknown, _opts: unknown) => ({
      status: 'completed', itemsProcessed: 3, startedAt: 0, completedAt: 1,
    }));

    vi.doMock('../browser/workflow/store.js', () => ({
      readWorkflow: async () => ({ id: 't', name: 'T', nodes: [], connections: [] }),
    }));
    vi.doMock('../browser/workflow/engine.js', () => ({ runWorkflow }));
    vi.doMock('../browser/dashboard/server.js', () => ({
      getDashboardServer: () => ({ port: 4243, broadcast: () => {} }),
    }));

    try {
      vi.resetModules();
      const { browseWorkflowCommand } = await import('../commands/browse-workflow.js');
      const run = browseWorkflowCommand.subcommands?.find(s => s.name === 'run');
      expect(run?.action).toBeDefined();

      await run!.action!({
        flags: { 'no-dashboard': true, items: itemsPath },
        args: ['wf.json'],
        cwd: dir,
      } as never);

      expect(runWorkflow).toHaveBeenCalledTimes(1);
      // Regression: --items was parsed and dropped, so runWorkflow always got
      // no items and fell back to its single empty default item.
      const opts = runWorkflow.mock.calls[0][1] as { items?: unknown[] };
      expect(opts.items).toEqual([{ data: { a: 1 } }, { data: { a: 2 } }, { data: { a: 3 } }]);
    } finally {
      vi.doUnmock('../browser/workflow/store.js');
      vi.doUnmock('../browser/workflow/engine.js');
      vi.doUnmock('../browser/dashboard/server.js');
      vi.resetModules();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('agent health --watch', () => {
  afterEach(() => { vi.doUnmock('../mcp-client.js'); vi.resetModules(); });

  const EMPTY_HEALTH = {
    agents: [], overall: { healthy: 0, degraded: 0, unhealthy: 0, avgCpu: 0, avgMemory: 0 },
  };

  it('keeps refreshing until interrupted instead of rendering once and exiting', async () => {
    const callMCPTool = vi.fn(async () => EMPTY_HEALTH);
    vi.doMock('../mcp-client.js', () => ({ callMCPTool, MCPClientError: class extends Error {} }));
    vi.resetModules();

    const { healthCommand } = await import('../commands/agent-ops.js');
    const { output } = await import('../output.js');
    const quiet = [
      vi.spyOn(output, 'writeln').mockImplementation(() => {}),
      vi.spyOn(output, 'printTable').mockImplementation(() => {}),
      vi.spyOn(output, 'printBox').mockImplementation(() => {}),
      vi.spyOn(output, 'printInfo').mockImplementation(() => {}),
    ];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const pending = healthCommand.action!({ flags: { watch: true }, args: [] } as never);

      // Regression: --watch was never read, so the action resolved immediately
      // after a single render. A watch loop must still be running here.
      const settled = await Promise.race([
        pending.then(() => 'resolved'),
        new Promise(r => setTimeout(() => r('still-watching'), 150)),
      ]);
      expect(settled).toBe('still-watching');

      process.emit('SIGINT');
      await expect(pending).resolves.toMatchObject({ success: true });
    } finally {
      write.mockRestore();
      for (const s of quiet) s.mockRestore();
    }
  });

  it('renders once and returns when --watch is not set', async () => {
    const callMCPTool = vi.fn(async () => EMPTY_HEALTH);
    vi.doMock('../mcp-client.js', () => ({ callMCPTool, MCPClientError: class extends Error {} }));
    vi.resetModules();

    const { healthCommand } = await import('../commands/agent-ops.js');
    const { output } = await import('../output.js');
    const quiet = [
      vi.spyOn(output, 'writeln').mockImplementation(() => {}),
      vi.spyOn(output, 'printTable').mockImplementation(() => {}),
      vi.spyOn(output, 'printBox').mockImplementation(() => {}),
    ];
    try {
      await expect(healthCommand.action!({ flags: {}, args: [] } as never)).resolves.toMatchObject({ success: true });
      expect(callMCPTool).toHaveBeenCalledTimes(1);
    } finally {
      for (const s of quiet) s.mockRestore();
    }
  });
});

describe('browser tools without an open session', () => {
  /**
   * Every browser tool needs an active CDP session. With none open they must
   * report that clearly rather than throwing — a throw surfaces to an MCP
   * client as a protocol error instead of an actionable message.
   */
  const NEEDS_SESSION = [
    'browser_click',
    'browser_fill',
    'browser_get-text',
    'browser_get-title',
    'browser_get-url',
    'browser_screenshot',
    'browser_snapshot',
    'browser_eval',
    'browser_press',
    'browser_scroll',
    'browser_back',
    'browser_forward',
    'browser_reload',
    'browser_close',
  ];

  it('every session-dependent tool fails gracefully instead of throwing', async () => {
    const { browserTools } = await import('../mcp-tools/browser-tools.js');
    const failures: string[] = [];

    for (const name of NEEDS_SESSION) {
      const tool = browserTools.find(t => t.name === name);
      if (!tool) continue;
      const args: Record<string, unknown> = {};
      for (const key of tool.inputSchema.required ?? []) args[key] = 'x';
      try {
        await tool.handler(args, undefined);
      } catch (e) {
        failures.push(`${name}: ${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 80)}`);
      }
    }

    expect(failures, `these threw instead of returning an error result:\n${failures.join('\n')}`).toEqual([]);
  }, 60_000);

  it('browser_session-list reports no sessions rather than failing', async () => {
    const { browserTools } = await import('../mcp-tools/browser-tools.js');
    const tool = browserTools.find(t => t.name === 'browser_session-list');
    expect(tool).toBeDefined();
    await expect(tool!.handler({}, undefined)).resolves.toBeDefined();
  });
});
