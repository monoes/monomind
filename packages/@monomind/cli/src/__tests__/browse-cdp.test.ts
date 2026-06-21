import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fake WebSocket — mimics the Node.js EventEmitter-style API that 'ws' uses
// ---------------------------------------------------------------------------
class FakeWS {
  readyState = 1; // OPEN
  sent: string[] = [];

  private _handlers: Record<string, Function[]> = {};

  on(event: string, fn: Function) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
    return this;
  }

  send(data: string, cb?: (err?: Error) => void) {
    this.sent.push(data);
    cb?.();
  }

  close() {
    this.emit('close');
  }

  emit(event: string, ...args: unknown[]) {
    for (const fn of this._handlers[event] ?? []) fn(...args);
  }

  /** Simulate a message arriving from the browser */
  simulateMessage(obj: unknown) {
    this.emit('message', JSON.stringify(obj));
  }
}

// ---------------------------------------------------------------------------
// Module-level reference so test helpers can access the last FakeWS instance
// ---------------------------------------------------------------------------
let fakeWsInstance: FakeWS | null = null;

// We need WebSocket to be constructable.  Use vi.fn() and expose a class-like
// constructor that captures the instance.
function FakeWebSocket(this: any, _url: string) {
  fakeWsInstance = new FakeWS();
  Object.assign(this, fakeWsInstance);
  // Proxy the FakeWS methods onto `this`
  for (const key of Object.getOwnPropertyNames(FakeWS.prototype)) {
    if (key !== 'constructor') {
      (this as any)[key] = (fakeWsInstance as any)[key].bind(fakeWsInstance);
    }
  }
  // Also expose sent and emit directly on `this`
  Object.defineProperty(this, 'sent', {
    get: () => fakeWsInstance!.sent,
    configurable: true,
  });
}

vi.mock('ws', () => ({
  WebSocket: FakeWebSocket,
}));

import { CdpClient } from '@monoes/monobrowse';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openClient(): { client: CdpClient; ws: FakeWS } {
  const client = new CdpClient();
  client.connect('ws://localhost:9222/devtools/page/abc');
  const ws = fakeWsInstance!;
  ws.emit('open');
  return { client, ws };
}

async function connectedClient(): Promise<{ client: CdpClient; ws: FakeWS }> {
  const { client, ws } = openClient();
  await Promise.resolve();
  return { client, ws };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CdpClient', () => {
  beforeEach(() => {
    fakeWsInstance = null;
    vi.clearAllMocks();
  });

  it('connects and resolves when the WebSocket opens', async () => {
    const client = new CdpClient();
    const p = client.connect('ws://localhost:9222/devtools/page/abc');
    fakeWsInstance!.emit('open');
    await expect(p).resolves.toBeUndefined();
    expect(client.isConnected()).toBe(true);
  });

  it('rejects when the WebSocket emits an error before opening', async () => {
    const client = new CdpClient();
    const p = client.connect('ws://localhost:9222/devtools/page/abc');
    const err = new Error('ECONNREFUSED');
    fakeWsInstance!.emit('error', err);
    await expect(p).rejects.toThrow('ECONNREFUSED');
  });

  it('sends a command and resolves with the response result', async () => {
    const { client, ws } = await connectedClient();

    const sendPromise = client.send<{ value: number }>('Runtime.evaluate', { expression: '1+1' });

    const sent = JSON.parse(ws.sent[0]) as { id: number; method: string };
    expect(sent.method).toBe('Runtime.evaluate');

    ws.simulateMessage({ id: sent.id, result: { value: 2 } });

    const result = await sendPromise;
    expect(result.value).toBe(2);
  });

  it('rejects a command when the response contains a CDP error', async () => {
    const { client, ws } = await connectedClient();

    const sendPromise = client.send('DOM.getDocument');
    const sent = JSON.parse(ws.sent[0]) as { id: number };
    ws.simulateMessage({ id: sent.id, error: { code: -32000, message: 'Not found' } });

    await expect(sendPromise).rejects.toThrow('CDP error -32000: Not found');
  });

  it('rejects when not connected', async () => {
    const client = new CdpClient();
    await expect(client.send('Page.navigate')).rejects.toThrow('CDP not connected');
  });

  it('enforces 1000 in-flight command cap', async () => {
    const { client, ws } = await connectedClient();

    // Override send to avoid callbacks so commands stay pending
    vi.spyOn(ws, 'send').mockImplementation((data: string) => {
      ws.sent.push(data);
    });

    // Fill up to 1000 pending
    for (let i = 0; i < 1000; i++) {
      client.send('Page.dummy').catch(() => {});
    }
    // 1001st command should be rejected immediately
    await expect(client.send('Page.overflow')).rejects.toThrow('queue full');
  });

  it('rejects all pending commands when the connection closes', async () => {
    const { client, ws } = await connectedClient();

    vi.spyOn(ws, 'send').mockImplementation((data: string) => {
      ws.sent.push(data);
      // no callback — keeps command in-flight
    });
    const pendingPromise = client.send('Page.navigate');

    ws.emit('close');

    await expect(pendingPromise).rejects.toThrow('CDP connection closed');
    expect(client.isConnected()).toBe(false);
  });

  it('fires event listeners when a CDP event arrives', async () => {
    const { client, ws } = await connectedClient();

    const listener = vi.fn();
    client.on('Page.loadEventFired', listener);

    ws.simulateMessage({ method: 'Page.loadEventFired', params: { timestamp: 1.23 } });

    expect(listener).toHaveBeenCalledWith({ timestamp: 1.23 }, undefined);
  });

  it('enforces 100 listener cap per event', async () => {
    const { client } = await connectedClient();

    for (let i = 0; i < 100; i++) {
      client.on('Page.frameNavigated', vi.fn());
    }
    expect(() => client.on('Page.frameNavigated', vi.fn())).toThrow(
      'CDP event listener limit reached',
    );
  });

  it('close() rejects pending commands and disconnects', async () => {
    const { client, ws } = await connectedClient();

    vi.spyOn(ws, 'send').mockImplementation((data: string) => {
      ws.sent.push(data);
    });
    const p = client.send('Network.enable');

    client.close();

    await expect(p).rejects.toThrow('CDP connection closed');
    expect(client.isConnected()).toBe(false);
  });

  it('once() resolves on the first matching event', async () => {
    const { client, ws } = await connectedClient();

    const oncePromise = client.once('Page.loadEventFired');
    ws.simulateMessage({ method: 'Page.loadEventFired', params: { timestamp: 99 } });

    const params = await oncePromise;
    expect(params).toEqual({ timestamp: 99 });
  });
});
