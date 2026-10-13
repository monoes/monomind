/** `monomind ui open` only claims success when the browser used the login link. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const openUrl = vi.fn();
vi.mock('../ui/server.mjs', () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));

import { uiCommand } from '../commands/ui.js';
import { output } from '../output.js';
import { consumeLoginNonce } from '../ui/human-auth.mjs';

const open = uiCommand.subcommands!.find((c) => c.name === 'open')!;
const ctx = { cwd: process.cwd(), flags: { port: 1 }, args: [] } as never;

describe('ui open', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    openUrl.mockReset();
  });

  it('reports success when the link is consumed', async () => {
    openUrl.mockImplementation(async (url: string) => {
      consumeLoginNonce(new URL(url).searchParams.get('login') as string);
    });
    const ok = vi.spyOn(output, 'printSuccess').mockImplementation(() => {});
    const res = await open.action!(ctx);
    expect(res?.success).toBe(true);
    expect(ok).toHaveBeenCalled();
  });

  it('does not claim success when the link stays unused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const ok = vi.spyOn(output, 'printSuccess').mockImplementation(() => {});
    const warn = vi.spyOn(output, 'printWarning').mockImplementation(() => {});
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    const p = open.action!(ctx);
    await vi.advanceTimersByTimeAsync(11_000);
    const res = await p;
    expect(ok).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('did not load the login link');
    expect(res?.exitCode).toBe(1); // port 1: nothing answers
  });
});
