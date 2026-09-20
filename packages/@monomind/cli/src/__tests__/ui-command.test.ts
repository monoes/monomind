import { describe, expect, it, vi } from 'vitest';
import { getCommandAsync, hasCommand } from '../commands/index.js';
import { uiCommand } from '../commands/ui.js';
import type { CommandContext } from '../types.js';

// The command only reaches its `catch` (and so returns instead of parking on
// SIGINT) if startServer rejects — which is all this needs, since the
// assertion is on the options it was handed.
const startServer = vi.fn(async () => {
  throw new Error('not starting a real dashboard in a unit test');
});
vi.mock('../ui/server.mjs', () => ({ startServer: (opts: unknown) => startServer(opts as never) }));

describe('ui command', () => {
  it('is registered in command registry and accessible via alias', async () => {
    expect(hasCommand('ui')).toBe(true);
    expect(hasCommand('dashboard')).toBe(true);

    const cmd = await getCommandAsync('ui');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('ui');
    expect(cmd?.aliases).toContain('dashboard');
  });

  it('has expected flags for port, open, no-open, and project-dir', () => {
    const optNames = uiCommand.options?.map((o) => o.name) || [];
    expect(optNames).toContain('port');
    expect(optNames).toContain('open');
    expect(optNames).toContain('no-open');
    expect(optNames).toContain('project-dir');
  });
});

// #308: the monomind home is only allowed to follow --project-dir when the
// user actually passed it. This command collapses the flag into a cwd default
// before calling startServer, so the explicit/defaulted distinction has to be
// forwarded separately or it is lost here — the exact wiring the home
// resolution depends on.
describe('ui command → startServer project-dir wiring (#308)', () => {
  function context(flags: Record<string, unknown>): CommandContext {
    return { args: [], flags: { _: [], ...flags } as never, cwd: '/tmp/some-project', interactive: false };
  }

  it('marks the project dir explicit when --project-dir was passed', async () => {
    startServer.mockClear();
    await uiCommand.action(context({ 'project-dir': '/tmp/named-project', open: false }));
    expect(startServer.mock.calls[0][0]).toMatchObject({
      projectDir: '/tmp/named-project',
      projectDirExplicit: true,
    });
  });

  it('marks the cwd default as not explicit when the flag is absent', async () => {
    startServer.mockClear();
    await uiCommand.action(context({ open: false }));
    expect(startServer.mock.calls[0][0]).toMatchObject({
      projectDir: '/tmp/some-project',
      projectDirExplicit: false,
    });
  });
});
