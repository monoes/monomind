/**
 * CdpClient dispatch/guard logic and the two HTTP endpoint helpers.
 *
 * No browser and no WebSocket server: `connect()` is exercised against a fake
 * `ws` module (so we can drive 'message'/'close'/'error' by hand), and
 * fetchTargets/fetchNewTarget run against a stubbed global fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- fake `ws` -------------------------------------------------------------
// Captures the most recently constructed socket so tests can drive its events.
let lastSocket: FakeWs | null = null;

class FakeWs {
  handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  sent: string[] = [];
  closed = false;
  /** When set, the `send` callback receives this error instead of success. */
  sendError: Error | null = null;

  constructor(public url: string) {
    lastSocket = this;
  }

  on(event: string, fn: (...a: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }

  send(data: string, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    cb?.(this.sendError ?? undefined);
  }

  close(): void {
    this.closed = true;
  }

  /** Convenience: deliver a CDP frame as the ws 'message' event does. */
  deliver(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }
}

vi.mock('ws', () => ({ WebSocket: FakeWs }));

const { CdpClient, fetchTargets, fetchNewTarget } = await import('../browser/cdp.js');
type Client = InstanceType<typeof CdpClient>;

/** Build a connected client plus its fake socket. */
async function connected(): Promise<{ client: Client; ws: FakeWs }> {
  const client = new CdpClient();
  const p = client.connect('ws://127.0.0.1:9222/devtools/page/ABC');
  lastSocket!.emit('open');
  await p;
  return { client, ws: lastSocket! };
}

beforeEach(() => {
  lastSocket = null;
});

describe('connect', () => {
  it('resolves on open and reports connected', async () => {
    const { client, ws } = await connected();
    expect(ws.url).toBe('ws://127.0.0.1:9222/devtools/page/ABC');
    expect(client.isConnected()).toBe(true);
  });

  it('rejects when the socket errors before ever opening', async () => {
    const client = new CdpClient();
    const p = client.connect('ws://127.0.0.1:1/devtools');
    lastSocket!.emit('error', new Error('ECONNREFUSED'));
    await expect(p).rejects.toThrow('ECONNREFUSED');
    expect(client.isConnected()).toBe(false);
  });
});

describe('send', () => {
  it('rejects when not connected rather than queueing forever', async () => {
    await expect(new CdpClient().send('Page.enable')).rejects.toThrow('CDP not connected');
  });

  it('serializes id/method/params and omits sessionId when not given', async () => {
    const { client, ws } = await connected();
    void client.send('Page.navigate', { url: 'https://x.test' });
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      id: 1,
      method: 'Page.navigate',
      params: { url: 'https://x.test' },
    });
  });

  it('attaches sessionId when supplied and increments ids monotonically', async () => {
    const { client, ws } = await connected();
    void client.send('A', {}, 'S1');
    void client.send('B', {}, 'S1');
    expect(JSON.parse(ws.sent[0]!).id).toBe(1);
    expect(JSON.parse(ws.sent[1]!)).toMatchObject({ id: 2, method: 'B', sessionId: 'S1' });
  });

  it('resolves with the response result matched by id', async () => {
    const { client, ws } = await connected();
    const a = client.send<{ v: string }>('A');
    const b = client.send<{ v: string }>('B');
    // Answer out of order to prove id matching, not FIFO.
    ws.deliver({ id: 2, result: { v: 'second' } });
    ws.deliver({ id: 1, result: { v: 'first' } });
    expect(await a).toEqual({ v: 'first' });
    expect(await b).toEqual({ v: 'second' });
  });

  it('resolves with {} when the response carries no result', async () => {
    const { client, ws } = await connected();
    const p = client.send('A');
    ws.deliver({ id: 1 });
    expect(await p).toEqual({});
  });

  it('rejects with the CDP error code and message', async () => {
    const { client, ws } = await connected();
    const p = client.send('Bad.method');
    ws.deliver({ id: 1, error: { code: -32601, message: 'method not found' } });
    await expect(p).rejects.toThrow('CDP error -32601: method not found');
  });

  it('rejects and forgets the command when the socket send callback errors', async () => {
    const { client, ws } = await connected();
    ws.sendError = new Error('socket write failed');
    await expect(client.send('A')).rejects.toThrow('socket write failed');
    // Not left pending: a later close() must not try to reject it a second time.
    ws.sendError = null;
    expect(() => client.close()).not.toThrow();
  });

  it('refuses to exceed the 1000 in-flight command cap', async () => {
    const { client } = await connected();
    const inflight = Array.from({ length: 1000 }, () => client.send('A').catch(() => {}));
    await expect(client.send('A')).rejects.toThrow('CDP command queue full (>1000 in-flight commands)');
    client.close();
    await Promise.all(inflight);
  });
});

describe('event dispatch', () => {
  it('routes events to listeners with params and sessionId', async () => {
    const { client, ws } = await connected();
    const seen: Array<[Record<string, unknown>, string | undefined]> = [];
    client.on('Page.loadEventFired', (params, sid) => seen.push([params, sid]));
    ws.deliver({ method: 'Page.loadEventFired', params: { timestamp: 5 }, sessionId: 'S1' });
    expect(seen).toEqual([[{ timestamp: 5 }, 'S1']]);
  });

  it('passes {} when the event has no params', async () => {
    const { client, ws } = await connected();
    const seen: Array<Record<string, unknown>> = [];
    client.on('E', (p) => seen.push(p));
    ws.deliver({ method: 'E' });
    expect(seen).toEqual([{}]);
  });

  it('the returned off() unsubscribes', async () => {
    const { client, ws } = await connected();
    let count = 0;
    const off = client.on('E', () => count++);
    ws.deliver({ method: 'E' });
    off();
    ws.deliver({ method: 'E' });
    expect(count).toBe(1);
  });

  it('isolates a throwing listener so siblings still run', async () => {
    const { client, ws } = await connected();
    let reached = false;
    client.on('E', () => {
      throw new Error('listener blew up');
    });
    client.on('E', () => {
      reached = true;
    });
    expect(() => ws.deliver({ method: 'E' })).not.toThrow();
    expect(reached).toBe(true);
  });

  it('swallows malformed frames instead of crashing the socket', async () => {
    const { client, ws } = await connected();
    expect(() => ws.emit('message', Buffer.from('{not json'))).not.toThrow();
    expect(client.isConnected()).toBe(true);
  });

  it('caps listeners per event at 100', async () => {
    const { client } = await connected();
    for (let i = 0; i < 100; i++) client.on('E', () => {});
    expect(() => client.on('E', () => {})).toThrow('CDP event listener limit reached for event: E');
    // The cap is per event name, not global.
    expect(() => client.on('OtherEvent', () => {})).not.toThrow();
  });
});

describe('once / onceWithOff', () => {
  it('resolves on the first matching event and self-unsubscribes', async () => {
    const { client, ws } = await connected();
    const p = client.once('E');
    ws.deliver({ method: 'E', params: { n: 1 } });
    ws.deliver({ method: 'E', params: { n: 2 } });
    expect(await p).toEqual({ n: 1 });
  });

  it('filters by sessionId when one is given', async () => {
    const { client, ws } = await connected();
    const p = client.once('E', 'S1');
    ws.deliver({ method: 'E', params: { from: 'S2' }, sessionId: 'S2' });
    ws.deliver({ method: 'E', params: { from: 'S1' }, sessionId: 'S1' });
    expect(await p).toEqual({ from: 'S1' });
  });

  it('onceWithOff returns a canceller that stops the waiter from firing', async () => {
    const { client, ws } = await connected();
    let settled = false;
    const [promise, off] = client.onceWithOff('E');
    void promise.then(() => {
      settled = true;
    });
    off();
    ws.deliver({ method: 'E' });
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe('teardown paths', () => {
  it('close() rejects every pending command, drops listeners and closes the socket', async () => {
    const { client, ws } = await connected();
    const pending = client.send('A');
    let events = 0;
    client.on('E', () => events++);

    client.close();

    await expect(pending).rejects.toThrow('CDP connection closed');
    expect(ws.closed).toBe(true);
    expect(client.isConnected()).toBe(false);
    ws.deliver({ method: 'E' });
    expect(events).toBe(0);
  });

  it('a socket "close" event rejects pending commands', async () => {
    const { client, ws } = await connected();
    const pending = client.send('A');
    ws.emit('close');
    await expect(pending).rejects.toThrow('CDP connection closed');
    expect(client.isConnected()).toBe(false);
  });

  it('a post-connect "error" flushes pending commands with that error', async () => {
    const { client, ws } = await connected();
    const pending = client.send('A');
    ws.emit('error', new Error('EPIPE'));
    await expect(pending).rejects.toThrow('EPIPE');
    expect(client.isConnected()).toBe(false);
  });
});

describe('fetchTargets / fetchNewTarget', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch(impl: (url: string, init?: RequestInit) => Response): ReturnType<typeof vi.fn> {
    const fn = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it('fetchTargets hits /json/list on the given port', async () => {
    const fn = stubFetch(() => new Response(JSON.stringify([{ id: 'T1', type: 'page' }]), { status: 200 }));
    await expect(fetchTargets(9333)).resolves.toEqual([{ id: 'T1', type: 'page' }]);
    expect(fn.mock.calls[0]![0]).toBe('http://127.0.0.1:9333/json/list');
  });

  it('fetchTargets throws on a non-OK response', async () => {
    stubFetch(() => new Response('nope', { status: 500, statusText: 'Internal Server Error' }));
    await expect(fetchTargets(9222)).rejects.toThrow('Failed to fetch targets: Internal Server Error');
  });

  it('fetchNewTarget uses PUT and percent-encodes the URL', async () => {
    const fn = stubFetch(() => new Response(JSON.stringify({ id: 'T2' }), { status: 200 }));
    await expect(fetchNewTarget(9222, 'https://x.test/a?b=1&c=2')).resolves.toEqual({ id: 'T2' });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(url).toBe(
      'http://127.0.0.1:9222/json/new?' + encodeURIComponent('https://x.test/a?b=1&c=2')
    );
    // The query separators of the target URL must not leak into Chrome's own query.
    expect(url.split('?').length).toBe(2);
  });

  it('fetchNewTarget throws on a non-OK response', async () => {
    stubFetch(() => new Response('', { status: 405, statusText: 'Method Not Allowed' }));
    await expect(fetchNewTarget(9222, 'about:blank')).rejects.toThrow(
      'Failed to create target: Method Not Allowed'
    );
  });

  it('rejects responses over the 10 MB body cap instead of parsing them', async () => {
    const huge = JSON.stringify([{ pad: 'x'.repeat(11 * 1024 * 1024) }]);
    stubFetch(() => new Response(huge, { status: 200 }));
    await expect(fetchTargets(9222)).rejects.toThrow(/CDP response too large: \d+ bytes/);
  });
});
