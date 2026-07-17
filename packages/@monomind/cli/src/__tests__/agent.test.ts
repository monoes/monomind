import { describe, it, expect, vi } from 'vitest';
import { agentCommand } from '../commands/agent.js';
import { spawnCommand, listCommand, statusCommand, stopCommand } from '../commands/agent-lifecycle.js';
import { metricsCommand, poolCommand, healthCommand } from '../commands/agent-ops.js';
import type { CommandContext } from '../types.js';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    args: [],
    flags: { _: [] },
    cwd: process.cwd(),
    interactive: false,
    ...overrides,
  };
}

describe('agentCommand registration', () => {
  it('registers all 7 documented subcommands, in the documented order', () => {
    expect(agentCommand.name).toBe('agent');
    expect(agentCommand.subcommands?.map((c) => c.name)).toEqual([
      'spawn',
      'list',
      'status',
      'stop',
      'metrics',
      'pool',
      'health',
    ]);
  });

  it('routes each subcommand name to the exact same Command object exported by the implementation modules', () => {
    // This guards against the wiring file (agent.ts) drifting from a
    // refactor in agent-lifecycle.ts / agent-ops.ts (e.g. a rename that
    // isn't mirrored in the subcommands array).
    const subs = agentCommand.subcommands ?? [];
    expect(subs[0]).toBe(spawnCommand);
    expect(subs[1]).toBe(listCommand);
    expect(subs[2]).toBe(statusCommand);
    expect(subs[3]).toBe(stopCommand);
    expect(subs[4]).toBe(metricsCommand);
    expect(subs[5]).toBe(poolCommand);
    expect(subs[6]).toBe(healthCommand);
  });

  it('has no top-level options and includes usage examples', () => {
    expect(agentCommand.options).toEqual([]);
    expect(agentCommand.examples?.length).toBeGreaterThan(0);
  });

  it('default action prints the subcommand menu and succeeds without touching the filesystem', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const result = await agentCommand.action!(makeCtx());
      expect(result).toEqual({ success: true });

      const printed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(printed).toContain('Agent Management Commands');
      // Every documented subcommand name should be mentioned in the help text.
      for (const name of ['spawn', 'list', 'status', 'stop', 'metrics', 'pool', 'health']) {
        expect(printed).toContain(name);
      }
    } finally {
      writeSpy.mockRestore();
    }
  });
});
