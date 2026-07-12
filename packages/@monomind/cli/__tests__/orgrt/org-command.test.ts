// packages/@monomind/cli/__tests__/orgrt/org-command.test.ts
import { describe, it, expect } from 'vitest';
import { orgCommand } from '../../src/commands/org.js';

describe('org command', () => {
  it('registers run/stop/status/serve/test-loop subcommands', () => {
    const names = (orgCommand.subcommands ?? []).map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['run', 'stop', 'status', 'serve', 'test-loop']));
  });
  it('run requires an org name', async () => {
    const run = orgCommand.subcommands!.find(c => c.name === 'run')!;
    const res = await run.action!({ args: [], flags: {}, cwd: process.cwd(), interactive: false } as any);
    expect(res?.success).toBe(false);
    expect(res?.message).toMatch(/org name/i);
  });
});
