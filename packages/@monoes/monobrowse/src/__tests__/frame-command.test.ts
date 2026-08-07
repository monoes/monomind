/**
 * frame command (#97) — switching to an iframe must retain the OOPIF
 * sessionId returned by switchToFrame so subsequent commands act on the
 * frame, and `frame main` must detach the frame session and restore the
 * page session. The browser engine is mocked; no real Chrome.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Command, CommandContext } from '../cli/types.js';

const mocks = vi.hoisted(() => {
  const send = vi.fn(async (_method: string, _params?: unknown, _sid?: string) => ({}));
  const client = { send, isConnected: () => true, close: vi.fn() };
  return {
    send,
    client,
    browser: {
      launchBrowser: vi.fn(async () => 9222),
      connectToTarget: vi.fn(async () => ({
        client,
        sessionId: 'S-PAGE',
        target: { id: 'T-PAGE', url: 'https://x.test' },
      })),
      loadActivePortInfo: vi.fn(async () => null),
      loadRefCache: vi.fn(async () => null),
      switchToFrame: vi.fn(async (): Promise<{ url: string | null; sessionId: string | null }> => ({ url: 'https://f.test/frame', sessionId: 'S-FRAME' })),
      enableSessionDomains: vi.fn(async () => {}),
      teardownRouteInterception: vi.fn(),
      stopRequestCapture: vi.fn(),
      teardownDialogHandling: vi.fn(),
      teardownConsoleCapture: vi.fn(),
    },
  };
});

vi.mock('../index.js', () => mocks.browser);

async function loadFrameCommand(): Promise<Command> {
  const mod = (await import('../cli/commands.js')).default;
  const cmd = mod.subcommands!.find((c) => c.name === 'frame');
  if (!cmd?.action) throw new Error('frame command not found');
  return cmd;
}

const ctx = (args: string[]): CommandContext => ({
  args,
  flags: { _: [] },
  cwd: process.cwd(),
  interactive: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.browser.loadActivePortInfo.mockResolvedValue(null);
  mocks.browser.loadRefCache.mockResolvedValue(null);
  mocks.browser.switchToFrame.mockResolvedValue({ url: 'https://f.test/frame', sessionId: 'S-FRAME' });
  mocks.browser.connectToTarget.mockResolvedValue({
    client: mocks.client,
    sessionId: 'S-PAGE',
    target: { id: 'T-PAGE', url: 'https://x.test' },
  });
});

describe('browse frame command (#97)', () => {
  it('stores the OOPIF sessionId, enables its domains, and `frame main` detaches it and restores the page session', async () => {
    vi.resetModules();
    const frame = await loadFrameCommand();

    // Enter the frame — engine reports the OOPIF session
    await frame.action!(ctx(['iframe']));
    expect(mocks.browser.switchToFrame).toHaveBeenCalledWith(mocks.client, 'S-PAGE', 'iframe');
    expect(mocks.browser.enableSessionDomains).toHaveBeenCalledWith(mocks.client, 'S-FRAME');

    // Back to main — must detach the FRAME session (proves _sessionId was updated)
    await frame.action!(ctx(['main']));
    const detach = mocks.send.mock.calls.find(
      ([m]) => m === 'Target.detachFromTarget'
    );
    expect(detach).toBeDefined();
    expect(detach![1]).toEqual({ sessionId: 'S-FRAME' });

    // Entering a frame again must start from the restored page session
    await frame.action!(ctx(['iframe']));
    expect(mocks.browser.switchToFrame).toHaveBeenLastCalledWith(mocks.client, 'S-PAGE', 'iframe');
  });

  it('keeps the page session when the frame has no OOPIF target', async () => {
    vi.resetModules();
    mocks.browser.switchToFrame.mockResolvedValue({ url: 'https://f.test/frame', sessionId: null });
    const frame = await loadFrameCommand();

    await frame.action!(ctx(['iframe']));
    expect(mocks.browser.enableSessionDomains).not.toHaveBeenCalled();

    // `frame main` with no stored parent session must not detach anything
    await frame.action!(ctx(['main']));
    expect(mocks.send.mock.calls.some(([m]) => m === 'Target.detachFromTarget')).toBe(false);
  });
});
