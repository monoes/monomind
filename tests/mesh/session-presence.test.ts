import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshOfflineError } from '../../packages/@monomind/cli/src/mesh/client.js';
import { createSessionPresence } from '../../packages/@monomind/cli/src/mesh/session-presence.js';

const input = { runtime: 'claude-code', pid: 7, project: 'p1', projectPath: '/w/p1', sessionId: 's1' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('session presence', () => {
  it('registers as a session and heartbeats on the interval', async () => {
    const call = vi.fn(async (req: Record<string, unknown>) =>
      req.op === 'hello' ? { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k1' } : { id: 'x', ok: true },
    );
    const p = createSessionPresence(call, 1000);
    expect(await p.join(input)).toBe('h/p1/s1');
    expect(call.mock.calls[0][0]).toMatchObject({ op: 'hello', tier: 'session', sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(2100);
    const beats = call.mock.calls.filter(([r]) => r.op === 'heartbeat');
    expect(beats).toHaveLength(2);
    expect(beats[0][0]).toMatchObject({ addr: 'h/p1/s1', key: 'k1' });
    await p.leave();
  });

  it('re-registers when the hub no longer knows it', async () => {
    let hellos = 0;
    const call = vi.fn(async (req: Record<string, unknown>) => {
      if (req.op === 'hello') return { id: 'x', ok: true, addr: 'h/p1/s1', key: `k${++hellos}` };
      return { id: 'x', ok: false, error: 'unauthorized' };
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(1100);
    expect(hellos).toBe(2);
    await p.leave();
  });

  it('survives an unreachable hub and stops heartbeating after leave', async () => {
    const call = vi.fn(async (req: Record<string, unknown>) => {
      if (req.op === 'hello') return { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k' };
      throw new MeshOfflineError();
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(1100);
    await p.leave();
    const n = call.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(call.mock.calls.length).toBe(n);
    expect(p.addr()).toBeUndefined();
  });

  it('throws when the hello itself is refused', async () => {
    const call = vi.fn(async () => ({ id: 'x', ok: false, error: 'alias_taken' }));
    const p = createSessionPresence(call, 1000);
    await expect(p.join({ ...input, alias: 'rev' })).rejects.toThrow('alias_taken');
  });
});
