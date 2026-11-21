/**
 * wrapCommanderCommand rebuilds an argv for the wrapped commander program.
 * It must parse that argv as `node <script> ...`, or commander reads the
 * leading 'node' as the subcommand name and rejects it.
 */
import { Command as Commander } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { wrapCommanderCommand } from '../cli/commander-adapter.js';

function factory(run: (...a: unknown[]) => void) {
  return () => {
    const program = new Commander('action').exitOverride();
    program
      .command('click')
      .argument('<selector>')
      .option('--timeout <ms>')
      .action((selector: string, opts: { timeout?: string }) => run(selector, opts));
    return program;
  };
}

const ctx = (args: string[], flags: Record<string, string | boolean> = {}) => ({
  args,
  flags,
  cwd: process.cwd(),
  interactive: false,
});

describe('wrapCommanderCommand', () => {
  it('runs the wrapped subcommand with its positional args and flags', async () => {
    const run = vi.fn();
    const wrapped = wrapCommanderCommand(factory(run));
    const click = wrapped.subcommands?.find((s) => s.name === 'click');
    expect(click).toBeDefined();
    const result = await click!.action!(ctx(['#go'], { timeout: '500' }));
    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledWith('#go', { timeout: '500' });
  });

  it('dispatches to a subcommand from the top-level action', async () => {
    const run = vi.fn();
    const wrapped = wrapCommanderCommand(factory(run));
    await wrapped.action!(ctx(['click', '#top']));
    expect(run).toHaveBeenCalledWith('#top', {});
  });
});
