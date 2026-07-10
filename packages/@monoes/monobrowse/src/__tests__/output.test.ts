import { describe, it, expect, beforeEach, vi } from 'vitest';

// The module exports a singleton `output` which reads process.stdout.isTTY at
// construction time. We need to control that, so we reset modules per test.

async function importOutput(isTTY: boolean) {
  vi.resetModules();
  // Stub isTTY before the module loads
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true });
  return import('../cli/output.js');
}

describe('OutputFormatter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('printSuccess calls console.log with the message', async () => {
    const { output } = await importOutput(false);
    output.printSuccess('done');
    expect(console.log).toHaveBeenCalledOnce();
    expect((console.log as any).mock.calls[0][0]).toContain('done');
  });

  it('printError calls console.error with the message and optional details', async () => {
    const { output } = await importOutput(false);
    output.printError('fail', 'reason');
    expect(console.error).toHaveBeenCalledTimes(2);
    expect((console.error as any).mock.calls[0][0]).toContain('fail');
    expect((console.error as any).mock.calls[1][0]).toContain('reason');
  });

  it('printWarning calls console.warn', async () => {
    const { output } = await importOutput(false);
    output.printWarning('careful');
    expect(console.warn).toHaveBeenCalledOnce();
    expect((console.warn as any).mock.calls[0][0]).toContain('careful');
  });

  it('printInfo calls console.log with info prefix', async () => {
    const { output } = await importOutput(false);
    output.printInfo('note');
    expect(console.log).toHaveBeenCalledOnce();
    expect((console.log as any).mock.calls[0][0]).toContain('note');
  });

  it('with color disabled (non-TTY), output contains no ANSI escape codes', async () => {
    const { output } = await importOutput(false);
    output.printSuccess('plain');
    const logged = (console.log as any).mock.calls[0][0] as string;
    expect(logged).not.toContain('\x1b[');
  });

  it('with color enabled (TTY), output contains ANSI escape codes', async () => {
    const { output } = await importOutput(true);
    output.printSuccess('colored');
    const logged = (console.log as any).mock.calls[0][0] as string;
    expect(logged).toContain('\x1b[');
  });
});
