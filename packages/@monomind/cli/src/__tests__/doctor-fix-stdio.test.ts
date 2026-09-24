/**
 * The install/fix subprocesses doctor runs must not write to stdout: under
 * `doctor --json` stdout holds only the JSON document. stdin stays inherited
 * so an interactive sudo prompt still works.
 */

import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execSync = vi.fn();

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const exec = Object.assign(vi.fn(), {
    // runCommand → promisify(exec): report an old tap so fixMonoesTools has an issue.
    [promisify.custom]: async (cmd: string) => {
      if (cmd === 'brew tap') return { stdout: 'nokhodian/tap\n', stderr: '' };
      throw new Error(`not mocked: ${cmd}`);
    },
  });
  return { ...actual, exec, execSync };
});

const { installClaudeCode } = await import('../commands/doctor-env-checks.js');
const { fixMonoesTools } = await import('../commands/doctor-monoes-checks.js');

describe('doctor fix subprocess stdio', () => {
  beforeEach(() => {
    execSync.mockReset();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('installClaudeCode sends npm output to stderr', async () => {
    await installClaudeCode();
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync.mock.calls[0][1].stdio).toEqual(['inherit', process.stderr, process.stderr]);
  });

  it('fixMonoesTools sends brew/curl/sudo output to stderr', async () => {
    await fixMonoesTools();
    expect(execSync).toHaveBeenCalled();
    for (const [, opts] of execSync.mock.calls)
      expect(opts.stdio).toEqual(['inherit', process.stderr, process.stderr]);
  });
});
