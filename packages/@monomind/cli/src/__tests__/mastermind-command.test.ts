import { describe, expect, it, vi } from 'vitest';
import { mastermindCommand } from '../commands/mastermind.js';
import { output } from '../output.js';
import type { CommandContext } from '../types.js';

function context(args: string[], flags: Record<string, unknown> = {}): CommandContext {
  return { args, flags, cwd: process.cwd(), interactive: false, config: {} } as CommandContext;
}

describe('mastermind command', () => {
  it('lists every canonical workflow', async () => {
    const write = vi.spyOn(output, 'writeln').mockImplementation((text) => text);
    try {
      const result = await mastermindCommand.action!(context([], { list: true }));
      expect(result).toMatchObject({ success: true });
      expect(write.mock.calls.flat().join('\n')).toContain('mastermind-plan');
      expect(write.mock.calls.flat().join('\n')).toContain('mastermind-org');
    } finally {
      write.mockRestore();
    }
  });

  it('prints the canonical package for a workflow alias', async () => {
    const write = vi.spyOn(output, 'writeln').mockImplementation((text) => text);
    try {
      const result = await mastermindCommand.action!(context(['run', 'plan'], { print: true }));
      expect(result).toMatchObject({ success: true, data: { name: 'mastermind-plan' } });
      expect(write).toHaveBeenCalledWith(expect.stringContaining('name: mastermind-plan'));
    } finally {
      write.mockRestore();
    }
  });

  it('rejects unknown workflows without attempting a platform runner', async () => {
    const error = vi.spyOn(output, 'error').mockImplementation((text) => text);
    const write = vi.spyOn(output, 'writeln').mockImplementation((text) => text);
    const info = vi.spyOn(output, 'info').mockImplementation((text) => text);
    try {
      const result = await mastermindCommand.action!(context(['run', 'missing'], { print: true }));
      expect(result).toMatchObject({ success: false, exitCode: 1 });
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown Mastermind workflow'));
    } finally {
      error.mockRestore();
      write.mockRestore();
      info.mockRestore();
    }
  });
});
