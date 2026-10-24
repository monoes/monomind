import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshOfflineError, type Reply } from '../../packages/@monomind/cli/src/mesh/client.js';
import { createSessionPresence } from '../../packages/@monomind/cli/src/mesh/session-presence.js';

const input = {
  runtime: 'claude-code',
  pid: 7,
  project: 'p1',
  projectPath: '/w/p1',
  sessionId: 's1',
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('session presence', () => {
  it('registers as a session and heartbeats on the interval', async () => {
    const call = vi.fn(async (req: Record<string, unknown>) =>
      req.op === 'hello'
        ? { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k1' }
        : { id: 'x', ok: true },
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

describe('session presence: races', () => {
  type Req = Record<string, unknown>;

  it('leave waits for an in-flight heartbeat, so no hello lands after the bye and bye carries the newest key', async () => {
    const order: string[] = [];
    let hellos = 0;
    let finishBeat!: (r: Reply) => void;
    const call = vi.fn((req: Req): Promise<Reply> => {
      order.push(String(req.op));
      if (req.op === 'hello') {
        hellos++;
        return Promise.resolve({ id: 'x', ok: true, addr: 'h/p1/s1', key: `k${hellos}` });
      }
      if (req.op === 'heartbeat') {
        return new Promise((resolve) => {
          finishBeat = resolve;
        });
      }
      return Promise.resolve({ id: 'x', ok: true });
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(1100); // a heartbeat is now in flight
    const leaving = p.leave();
    finishBeat({ id: 'x', ok: false, error: 'unauthorized' }); // the beat re-registers (k2)
    await leaving;
    expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ op: 'bye', key: 'k2' });
    expect(order.lastIndexOf('hello')).toBeLessThan(order.lastIndexOf('bye'));
    expect(p.addr()).toBeUndefined();
  });

  it('two overlapping joins leave exactly one heartbeat timer', async () => {
    const call = vi.fn(
      async (req: Req): Promise<Reply> =>
        req.op === 'hello'
          ? { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k' }
          : { id: 'x', ok: true },
    );
    const p = createSessionPresence(call, 1000);
    await Promise.all([p.join(input), p.join(input)]);
    call.mockClear();
    await vi.advanceTimersByTimeAsync(1100);
    expect(call.mock.calls.filter(([r]) => r.op === 'heartbeat')).toHaveLength(1);
    await p.leave();
  });

  it('never runs two heartbeats at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const pending: Array<() => void> = [];
    const call = vi.fn((req: Req): Promise<Reply> => {
      if (req.op === 'hello')
        return Promise.resolve({ id: 'x', ok: true, addr: 'h/p1/s1', key: 'k' });
      if (req.op !== 'heartbeat') return Promise.resolve({ id: 'x', ok: true });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        pending.push(() => {
          inFlight--;
          resolve({ id: 'x', ok: true });
        }),
      );
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(6000); // six ticks while the first heartbeat is still unanswered
    expect(call.mock.calls.filter(([r]) => r.op === 'heartbeat')).toHaveLength(1);
    expect(maxInFlight).toBe(1);
    for (const answer of pending.splice(0)) answer();
    await p.leave();
  });

  it('re-registers with the key it held, so the hub can tell an owner from a squatter', async () => {
    let hellos = 0;
    const call = vi.fn(async (req: Req): Promise<Reply> => {
      if (req.op === 'hello') {
        hellos++;
        return { id: 'x', ok: true, addr: 'h/p1/s1', key: `k${hellos}` };
      }
      return { id: 'x', ok: false, error: 'unauthorized' };
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(1100);
    const rehello = call.mock.calls.filter(([r]) => r.op === 'hello')[1][0];
    expect(rehello).toMatchObject({ key: 'k1' });
    await p.leave();
  });

  it('keeps heartbeating (does not throw) when the hub refuses the address as taken', async () => {
    const call = vi.fn(async (req: Req): Promise<Reply> => {
      if (req.op === 'hello' && req.key === undefined)
        return { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k1' };
      if (req.op === 'hello') return { id: 'x', ok: false, error: 'addr_in_use' };
      return { id: 'x', ok: false, error: 'unauthorized' };
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(3200);
    await p.leave();
  });
});

describe('session presence: failure paths', () => {
  type Req = Record<string, unknown>;

  it('keeps heartbeating the existing registration when a second join is refused', async () => {
    let hellos = 0;
    const call = vi.fn(async (req: Req): Promise<Reply> => {
      if (req.op === 'hello') {
        hellos++;
        return hellos === 1
          ? { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k1' }
          : { id: 'x', ok: false, error: 'alias_taken' };
      }
      return { id: 'x', ok: true };
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await expect(p.join({ ...input, alias: 'taken' })).rejects.toThrow('alias_taken');
    call.mockClear();
    await vi.advanceTimersByTimeAsync(2100);
    expect(call.mock.calls.filter(([r]) => r.op === 'heartbeat')).toHaveLength(2);
    expect(p.addr()).toBe('h/p1/s1');
    await p.leave();
  });

  it('sends bye without spawning a hub, and resumes with its key after a failed bye', async () => {
    const calls: Req[] = [];
    let byeFails = true;
    const call = vi.fn(async (req: Req): Promise<Reply> => {
      calls.push(req);
      if (req.op === 'bye' && byeFails) throw new MeshOfflineError();
      if (req.op === 'hello') return { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k1' };
      return { id: 'x', ok: true };
    });
    const bye = vi.fn(async (): Promise<Reply> => {
      throw new MeshOfflineError();
    });
    const p = createSessionPresence(call, 1000, bye);
    await p.join(input);
    await p.leave();
    expect(bye).toHaveBeenCalledTimes(1);
    expect(calls.some((r) => r.op === 'bye')).toBe(false); // bye did not go through the spawning call
    byeFails = false;
    await p.join(input);
    expect(calls.filter((r) => r.op === 'hello')[1]).toMatchObject({ key: 'k1' });
    await p.leave();
  });

  it('keeps sending heartbeats on later ticks when the hub refuses to give the address back', async () => {
    const call = vi.fn(async (req: Req): Promise<Reply> => {
      if (req.op === 'hello' && req.key === undefined)
        return { id: 'x', ok: true, addr: 'h/p1/s1', key: 'k1' };
      if (req.op === 'hello') return { id: 'x', ok: false, error: 'addr_in_use' };
      return { id: 'x', ok: false, error: 'unauthorized' };
    });
    const p = createSessionPresence(call, 1000);
    await p.join(input);
    await vi.advanceTimersByTimeAsync(3200);
    expect(call.mock.calls.filter(([r]) => r.op === 'heartbeat').length).toBeGreaterThanOrEqual(3);
    expect(p.addr()).toBe('h/p1/s1');
    await p.leave();
  });
});
